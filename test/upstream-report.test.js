// Spec #35 (upstream issue reporting) C1-C6. GitHub is a local stand-in; nothing here
// reaches the real site.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { connect } from "node:net";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";
import { STORYBENCH_TOOLS } from "../src/codex.js";
import { defaultBootContextFor, mergeTools } from "../src/runtime/app-runtime.js";
import { startBridge } from "../src/runtime/bridge.js";
import { credentialSecrets } from "../src/runtime/credentials.js";
import { WorkerCodexConnection } from "../src/runtime/harnesses.js";
import { loadTemplates, renderEpisodeBoot } from "../src/runtime/boot.js";
import { createHost } from "../src/runtime/host.js";
import { selectKindTools } from "../src/runtime/kinds.js";
import { createScopedTools } from "../src/runtime/tools.js";
import { validateControlRequest } from "../src/runtime/validate.js";
import { ISSUE_TEMPLATES, UPSTREAM, UPSTREAM_DEFINITIONS, UPSTREAM_LIMITS, upstreamDestination } from "../src/upstream-report.js";

const NAMES = ["find_upstream_issues", "prepare_upstream_report", "read_upstream_issue"];
const REPO = "/repos/jedbjorn/storybench";
const SECRET = "sk-live-request-credential-0123456789";
const issue = (number, title, extra = {}) => ({ number, title, state: "open", html_url: `https://github.com/jedbjorn/storybench/issues/${number}`,
  created_at: `2026-11-${String(number % 28 + 1).padStart(2, "0")}T00:00:00Z`, user: { login: "someone" }, body: `Body of ${number}`,
  repository_url: `https://api.github.com${REPO}`, ...extra });

// A local stand-in for GitHub's REST API. `mode` selects what it answers.
async function standIn(t) {
  const state = { mode: "ok", requests: [], search: [issue(98, "Deck export drops the last slide")], issues: new Map() };
  const limited = (res) => { res.writeHead(403, { "content-type": "application/json", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794979979" }); res.end('{"message":"API rate limit exceeded for 203.0.113.9."}'); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://stand-in");
    state.requests.push({ path: url.pathname, query: url.searchParams, headers: req.headers });
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (state.mode === "limited") return limited(res);
    if (state.mode === "throttled") return send(429, { message: "Too many requests" });
    if (state.mode === "broken") return send(500, { message: "Server error" });
    if (url.pathname === "/search/issues") return send(200, { total_count: state.search.length, items: state.search });
    if (url.pathname === `${REPO}/issues`) return state.mode === "list-limited" ? limited(res) : send(200, [
      ...Array.from({ length: 25 }, (_, index) => issue(200 - index, `Recent ${200 - index}`)),
      issue(150, "A pull request", { pull_request: { url: "x" } }),
    ]);
    const number = new RegExp(`^${REPO}/issues/(\\d+)$`).exec(url.pathname)?.[1];
    if (number && state.issues.has(Number(number))) return send(200, state.issues.get(Number(number)));
    return send(404, { message: "Not Found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { state, apiBase: `http://127.0.0.1:${server.address().port}` };
}

async function fixture(t, { kind = "video" } = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "sb-upstream-"));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: "Report fixture", kind });
  const conversation = app.chat.create(episode.id, { name: "Reports" });
  const github = await standIn(t);
  const scope = (harness = "claude") => ({ requestId: "request_one", conversationId: conversation.id, harness, channelId: episode.channelId, episodeId: episode.id,
    dataRoot: workspace, episodeDir: workspace, workDir: workspace });
  const upstream = { apiBase: github.apiBase, screenCredential: async (text) => text.includes(SECRET) };
  const tools = createScopedTools(scope(), { store: app.store, upstream });
  t.after(() => tools.close());
  const call = async (name, args) => JSON.parse((await tools.call(name, args)).text);
  const rows = () => app.store.db.prepare("SELECT * FROM upstream_reports ORDER BY rowid").all();
  return { app, episode, conversation, github, scope, upstream, tools, call, rows };
}

test("the destination is the package metadata value and names real templates", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.bugs.url, "https://github.com/jedbjorn/storybench/issues");
  assert.equal(pkg.repository.url, "git+https://github.com/jedbjorn/storybench.git");
  assert.deepEqual({ ...UPSTREAM }, { ...upstreamDestination(pkg) });
  assert.equal(UPSTREAM.repository, "jedbjorn/storybench");
  assert.ok(Object.isFrozen(UPSTREAM));
  for (const file of Object.values(ISSUE_TEMPLATES)) await readFile(new URL(`../.github/ISSUE_TEMPLATE/${file}`, import.meta.url));
  // The private advisory form is the one the repository's own issue chooser points to.
  assert.ok((await readFile(new URL("../.github/ISSUE_TEMPLATE/config.yml", import.meta.url), "utf8")).includes(`url: ${UPSTREAM.securityAdvisory}\n`));
  // A fork changes its tracker only by shipping different metadata; mismatched metadata does not load.
  assert.equal(upstreamDestination({ bugs: { url: "https://github.com/fork/bench/issues" }, repository: { url: "git+https://github.com/fork/bench.git" } }).repository, "fork/bench");
  for (const bad of [{}, { bugs: { url: "https://example.com/a/b/issues" }, repository: pkg.repository }, { bugs: pkg.bugs, repository: { url: "git+https://github.com/other/repo.git" } },
    { bugs: { url: "https://github.com/a/b/issues?x=1" }, repository: { url: "git+https://github.com/a/b.git" } }]) assert.throws(() => upstreamDestination(bad));
});

test("C1: a prepared report redirects to the fixed destination's prefilled form with the matching template", async (t) => {
  const { app, conversation, call, rows } = await fixture(t);
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const title = "[Bug] Export drops the last slide — 100% of the time & more";
  const body = "## What happened\n\nLine one  \r\nline two + plus, #hash, ?query=1&other=2, 50%, \"quotes\", `code`, <tag>, émoji 🎬\n\n```\nfenced\tblock\n```\n";
  const cases = [["bug", "bug_report.md", title, body], ["feature", "feature_request.md", "Idea: timeline zoom", "Short body"]];
  for (const [kind, template, wantTitle, wantBody] of cases) {
    const prepared = await call("prepare_upstream_report", { kind, title: wantTitle, body: wantBody });
    assert.equal(prepared.prepared, true); assert.equal(prepared.submitted, false);
    assert.equal(prepared.repository, "jedbjorn/storybench");
    assert.match(prepared.link, /^\/report\/[0-9a-f]{16}$/);
    const stored = app.store.getUpstreamReport(prepared.reportId);
    assert.deepEqual({ ...stored, createdAt: null }, { reportId: prepared.reportId, episodeId: conversation.episodeId, conversationId: conversation.id, requestId: "request_one",
      kind, title: wantTitle, body: wantBody, createdAt: null, openedAt: null });
    const response = await fetch(`${base}${prepared.link}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const location = response.headers.get("location"), target = new URL(location);
    assert.equal(location.length, prepared.encodedLength);
    assert.equal(`${target.origin}${target.pathname}`, "https://github.com/jedbjorn/storybench/issues/new");
    assert.deepEqual([...target.searchParams.keys()], ["template", "title", "body"]);
    assert.equal(target.searchParams.get("template"), template);
    assert.equal(target.searchParams.get("title"), wantTitle);
    assert.equal(target.searchParams.get("body"), wantBody);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    // Opening records "opened" and nothing else; a second open and a HEAD change nothing further.
    const opened = app.store.getUpstreamReport(prepared.reportId);
    assert.ok(opened.openedAt);
    assert.deepEqual({ ...opened, openedAt: null }, stored);
    assert.equal((await fetch(`${base}${prepared.link}`, { redirect: "manual" })).status, 302);
    assert.equal((await fetch(`${base}${prepared.link}`, { method: "HEAD", redirect: "manual" })).status, 302);
    assert.deepEqual(app.store.getUpstreamReport(prepared.reportId), opened);
  }
  assert.equal(rows().length, 2);
  assert.equal((await fetch(`${base}/report/0000000000000000`, { redirect: "manual" })).status, 404);
  assert.equal((await fetch(`${base}/report/${rows()[0].id}`, { method: "POST", redirect: "manual" })).status, 404);
  // The link works while its conversation exists, and the report is removed with it.
  const link = `/report/${rows()[0].id}`;
  app.store.db.prepare("DELETE FROM conversations WHERE id=?").run(conversation.id);
  assert.equal(rows().length, 0);
  assert.equal((await fetch(`${base}${link}`, { redirect: "manual" })).status, 404);
});

test("C2: empty, oversized, credential-bearing and extra-field reports are refused with a reason and nothing is stored or trimmed", async (t) => {
  const { app, scope, github, call, rows, tools } = await fixture(t);
  const good = { kind: "bug", title: "Title", body: "Body" };
  const refusals = [
    [{ ...good, title: "" }, "EMPTY_REPORT", /title is empty/],
    [{ ...good, title: "  \n " }, "EMPTY_REPORT", /title is empty/],
    [{ ...good, body: "" }, "EMPTY_REPORT", /body is empty/],
    [{ kind: "bug", title: "Title" }, "EMPTY_REPORT", /body is empty/],
    [{ ...good, body: "x".repeat(UPSTREAM_LIMITS.encodedAddress) }, "REPORT_TOO_LONG", /limit is 6000\. Nothing was stored or shortened/],
    [{ ...good, body: "é".repeat(1000) }, "REPORT_TOO_LONG", /once encoded/],
    [{ ...good, body: `My key is ${SECRET} and it fails` }, "CREDENTIAL_IN_REPORT", /provider credential/],
    [{ ...good, title: `Leak ${SECRET}` }, "CREDENTIAL_IN_REPORT", /provider credential/],
    [{ ...good, repository: "evil/repo" }, "UNEXPECTED_FIELDS", /repository.*destination repository is fixed/],
    [{ ...good, labels: ["x"], assignee: "y" }, "UNEXPECTED_FIELDS", /labels, assignee/],
    [{ ...good, kind: "security" }, "INVALID_KIND", /bug or feature/],
    [{ ...good, body: "broken \ud800 surrogate" }, "INVALID_TEXT", /broken character/],
  ];
  for (const [args, code, reason] of refusals) {
    await assert.rejects(tools.call("prepare_upstream_report", args), (error) => error.code === code && reason.test(error.message), JSON.stringify(args).slice(0, 80));
    assert.equal(rows().length, 0);
  }
  // The longest report that fits is stored whole, byte for byte; one character more is refused.
  const room = UPSTREAM_LIMITS.encodedAddress - (await call("prepare_upstream_report", good)).encodedLength;
  const longest = `Body${"y".repeat(room)}`;
  const kept = await call("prepare_upstream_report", { ...good, body: longest });
  assert.equal(kept.encodedLength, UPSTREAM_LIMITS.encodedAddress);
  assert.equal(app.store.getUpstreamReport(kept.reportId).body, longest);
  await assert.rejects(tools.call("prepare_upstream_report", { ...good, body: `${longest}y` }), { code: "REPORT_TOO_LONG" });
  assert.deepEqual(rows().map(({ title, body }) => [title, body]), [["Title", "Body"], ["Title", longest]]);
  // A report that cannot be screened is not prepared: the screen failing, or none being wired.
  for (const upstream of [{ screenCredential: async () => { throw new Error("host gone"); } }, {}]) {
    const unscreened = createScopedTools(scope(), { store: app.store, upstream });
    await assert.rejects(unscreened.call("prepare_upstream_report", good), { code: "SCREEN_UNAVAILABLE" });
    await unscreened.close();
  }
  assert.equal(rows().length, 2);
  assert.equal(github.state.requests.length, 0, "preparing a report sends nothing to GitHub");
});

test("the host screens report text against the one credential passed to that request", async (t) => {
  assert.deepEqual(credentialSecrets(Buffer.from(JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: "idtoken-1", access_token: "access-2", refresh_token: "refresh-3", account_id: "acct" }, last_refresh: "2026-11-18T00:00:00Z" }))),
    ["idtoken-1", "access-2", "refresh-3"]);
  assert.deepEqual(credentialSecrets(Buffer.from(JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-abc", refreshToken: "sk-ant-ort01-def", expiresAt: 1, scopes: ["user:inference", "user:profile"], subscriptionType: "max" }, other: { blob: "z".repeat(40) } }))),
    ["sk-ant-oat01-abc", "sk-ant-ort01-def", "z".repeat(40)]);
  assert.deepEqual(credentialSecrets(Buffer.from("not json")), []);
  assert.deepEqual(validateControlRequest({ op: "worker.screen", requestId: "req-one", text: "abc" }), { op: "worker.screen", requestId: "req-one", text: "abc" });
  assert.throws(() => validateControlRequest({ op: "worker.screen", requestId: "req-one" }), { code: "INVALID_REQUEST" });
  assert.throws(() => validateControlRequest({ op: "worker.screen", requestId: "req-one", text: "abc", source: "x" }), { code: "UNEXPECTED_FIELDS" });

  const root = await mkdtemp(path.join(os.tmpdir(), "sb-screen-")); t.after(() => rm(root, { recursive: true, force: true }));
  const config = { installId: "screen-test", dataRoot: path.join(root, "data"), stateRoot: path.join(root, "state"), runtimeRoot: path.join(root, "runtime"), port: 4000,
    images: { app: `sha256:${"a".repeat(64)}`, worker: `sha256:${"b".repeat(64)}` }, credentials: { codex: "/absent/auth.json", claude: "/absent/.credentials.json" } };
  await mkdir(path.join(config.dataRoot, "episodes", "ep", "work"), { recursive: true });
  const route = { id: "openrouter", harness: "opencode", protocol: "openai", baseUrl: "https://gateway.example/v1", key: SECRET, env: "STORYBENCH_OPENROUTER_KEY" };
  const host = createHost(config, { providerService: { route: async () => route }, log: () => {}, followLogs: () => ({ stop() {} }), dockerApi: {
    async docker() { return "c".repeat(64); }, async listByLabels() { return []; }, async inspectContainer() { return null; }, async ensureNetwork() {},
  } });
  await host.handle({ op: "worker.start", requestId: "req-one", source: "openrouter", harness: "opencode", model: "fake", segmentId: "seg-one", episodeDir: "episodes/ep", workDir: "episodes/ep/work" });
  assert.deepEqual(await host.handle({ op: "worker.screen", requestId: "req-one", text: `before ${SECRET} after` }), { requestId: "req-one", contains: true });
  assert.deepEqual(await host.handle({ op: "worker.screen", requestId: "req-one", text: "an ordinary report" }), { requestId: "req-one", contains: false });
  await assert.rejects(host.handle({ op: "worker.screen", requestId: "req-other", text: SECRET }), { code: "UNKNOWN_REQUEST" });
  await host.handle({ op: "worker.stop", requestId: "req-one" });
  await assert.rejects(host.handle({ op: "worker.screen", requestId: "req-one", text: SECRET }), { code: "UNKNOWN_REQUEST" });

  // A login request is screened against the staged copy of the host login.
  const login = path.join(root, ".credentials.json");
  await writeFile(login, JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-login-access", refreshToken: "sk-ant-ort01-login-refresh", expiresAt: Date.now() + 3_600_000, scopes: ["user:inference"] } }), { mode: 0o600 });
  const loginHost = createHost({ ...config, credentials: { codex: "/absent/auth.json", claude: login } }, { log: () => {}, followLogs: () => ({ stop() {} }), dockerApi: {
    async docker() { return "d".repeat(64); }, async listByLabels() { return []; }, async inspectContainer() { return null; }, async ensureNetwork() {},
  } });
  await loginHost.handle({ op: "worker.start", requestId: "req-login", harness: "claude", model: "sonnet", segmentId: "seg-login", episodeDir: "episodes/ep", workDir: "episodes/ep/work" });
  for (const [text, contains] of [["token sk-ant-oat01-login-access here", true], ["sk-ant-ort01-login-refresh", true], ["user:inference is a scope, not a secret", false], [SECRET, false]])
    assert.deepEqual(await loginHost.handle({ op: "worker.screen", requestId: "req-login", text }), { requestId: "req-login", contains });
  await loginHost.handle({ op: "worker.stop", requestId: "req-login" });
});

test("C3: no input to any of the three tools reaches another repository", async (t) => {
  const { github, call, tools, rows } = await fixture(t);
  for (const [name, args] of [
    ["find_upstream_issues", { query: "crash", repository: "evil/repo" }], ["find_upstream_issues", { query: "crash", repo: "evil/repo", owner: "evil" }],
    ["prepare_upstream_report", { kind: "bug", title: "T", body: "B", repo: "evil/repo" }], ["prepare_upstream_report", { kind: "bug", title: "T", body: "B", url: "https://github.com/evil/repo" }],
    ["read_upstream_issue", { number: 1, repository: "evil/repo" }], ["read_upstream_issue", { number: 1, owner: "evil", repo: "repo" }],
  ]) await assert.rejects(tools.call(name, args), { code: "UNEXPECTED_FIELDS" }, name);
  for (const number of ["evil/repo#1", "1", "../../evil/repo/issues/1", 1.5, 0, -3, null, 2 ** 60]) await assert.rejects(tools.call("read_upstream_issue", { number }), { code: "INVALID_NUMBER" });
  for (const query of ["", "   ", ":::", 7, "x".repeat(UPSTREAM_LIMITS.query + 1)]) await assert.rejects(tools.call("find_upstream_issues", { query }), { code: "INVALID_QUERY" });
  assert.equal(github.state.requests.length, 0);
  assert.equal(rows().length, 0);

  // Qualifier syntax in the search words is flattened to plain words; the only repository named is the fixed one.
  github.state.search = [issue(98, "Ours"), issue(5, "Theirs", { repository_url: "https://api.github.com/repos/evil/repo", html_url: "https://github.com/evil/repo/issues/5" })];
  github.state.issues.set(98, issue(98, "Ours"));
  const found = await call("find_upstream_issues", { query: 'crash repo:evil/repo org:evil -repo:jedbjorn/storybench "is:pr" user:evil' });
  assert.equal(found.repository, "jedbjorn/storybench");
  assert.deepEqual(found.matches.map(({ number }) => number), [98], "an issue from another repository is never returned");
  assert.equal((await call("read_upstream_issue", { number: 98 })).url, "https://github.com/jedbjorn/storybench/issues/98");
  const [search, list, read] = github.state.requests;
  assert.equal(search.query.get("q"), "crash repo evil repo org evil repo jedbjorn storybench is pr user evil repo:jedbjorn/storybench is:issue");
  assert.equal(search.path, "/search/issues"); assert.equal(list.path, `${REPO}/issues`); assert.equal(read.path, `${REPO}/issues/98`);
  assert.equal(github.state.requests.length, 3);
  // Unauthenticated: the request carries no credential of any kind.
  for (const { headers } of github.state.requests) {
    assert.equal(headers.authorization, undefined); assert.equal(headers.cookie, undefined);
    assert.equal(headers["user-agent"], "storybench");
  }
  for (const definition of UPSTREAM_DEFINITIONS) assert.equal(definition.inputSchema.additionalProperties, false);
});

test("C4: the duplicate check tells none found from could not check", async (t) => {
  const { app, github, upstream, scope, call } = await fixture(t);
  const prepared = await call("prepare_upstream_report", { kind: "bug", title: "Earlier report", body: "Body" });
  const matches = await call("find_upstream_issues", { query: "export drops slide" });
  assert.equal(matches.checked, true);
  assert.deepEqual(matches.matches, [{ number: 98, title: "Deck export drops the last slide", state: "open", url: "https://github.com/jedbjorn/storybench/issues/98", createdAt: "2026-11-15T00:00:00Z" }]);
  assert.equal(matches.recent.length, UPSTREAM_LIMITS.recent);
  assert.deepEqual(matches.recent.slice(0, 2).map(({ number }) => number), [200, 199]);
  assert.ok(matches.recent.every(({ title }) => title !== "A pull request"));
  // Reports already prepared in this production are visible to a later turn.
  assert.deepEqual(matches.prepared.map(({ reportId, title }) => [reportId, title]), [[prepared.reportId, "Earlier report"]]);

  github.state.search = Array.from({ length: 14 }, (_, index) => issue(index + 1, `Match ${index + 1}`));
  assert.equal((await call("find_upstream_issues", { query: "many" })).matches.length, UPSTREAM_LIMITS.matches);
  github.state.search = [];
  const none = await call("find_upstream_issues", { query: "nothing like this" });
  assert.equal(none.checked, true); assert.deepEqual(none.matches, []); assert.equal(none.reason, undefined);

  for (const [mode, reason] of [["limited", /^Not checked: GitHub's rate limit .* resets at 2026-11-1\dT.*not "no duplicates"/], ["list-limited", /^Not checked: GitHub's rate limit/],
    ["throttled", /^Not checked: GitHub's rate limit/], ["broken", /^Not checked: GitHub answered HTTP 500/]]) {
    github.state.mode = mode;
    const before = github.state.requests.length;
    const result = await call("find_upstream_issues", { query: "export" });
    assert.equal(result.checked, false, mode); assert.match(result.reason, reason);
    assert.deepEqual([result.matches, result.recent], [[], []]);
    assert.ok(github.state.requests.length - before <= 2, "a refusal is not retried");
  }
  // Network failure: nothing listens at the stand-in's address.
  const dead = http.createServer(); await new Promise((resolve) => dead.listen(0, "127.0.0.1", resolve));
  const deadBase = `http://127.0.0.1:${dead.address().port}`; await new Promise((resolve) => dead.close(resolve));
  const offline = createScopedTools(scope(), { store: app.store, upstream: { ...upstream, apiBase: deadBase } });
  t.after(() => offline.close());
  const unreachable = JSON.parse((await offline.call("find_upstream_issues", { query: "export" })).text);
  assert.equal(unreachable.checked, false); assert.match(unreachable.reason, /^Not checked: GitHub could not be reached/);
  // The same failures on read-back are "not read", never "missing".
  const unread = JSON.parse((await offline.call("read_upstream_issue", { number: 98 })).text);
  assert.equal(unread.found, false); assert.match(unread.reason, /^Not read: GitHub could not be reached/);
  github.state.mode = "limited";
  const limited = await call("read_upstream_issue", { number: 98 });
  assert.equal(limited.found, false); assert.match(limited.reason, /^Not read: GitHub's rate limit/);
});

test("C5: read-back returns the real issue, names its prepared report, and reports a missing issue as not found", async (t) => {
  const { github, call } = await fixture(t);
  const prepared = await call("prepare_upstream_report", { kind: "bug", title: "Export drops the last slide", body: "Body" });
  github.state.issues.set(123, issue(123, " Export drops the last slide ", { state: "closed", user: { login: "creator" }, body: "Filed body" }));
  github.state.issues.set(124, issue(124, "Unrelated", { body: "z".repeat(UPSTREAM_LIMITS.issueBody + 50) }));
  github.state.issues.set(125, issue(125, "A pull request", { pull_request: { url: "x" } }));
  const read = await call("read_upstream_issue", { number: 123 });
  assert.deepEqual({ ...read, note: undefined }, { repository: "jedbjorn/storybench", number: 123, found: true, title: " Export drops the last slide ", state: "closed", author: "creator",
    createdAt: "2026-11-12T00:00:00Z", url: "https://github.com/jedbjorn/storybench/issues/123", body: "Filed body", bodyTruncated: false, reportId: prepared.reportId, note: undefined });
  assert.match(read.note, /never instruction/);
  const other = await call("read_upstream_issue", { number: 124 });
  assert.equal(other.found, true); assert.equal(other.reportId, undefined);
  assert.equal(other.body.length, UPSTREAM_LIMITS.issueBody); assert.equal(other.bodyTruncated, true);
  assert.deepEqual(await call("read_upstream_issue", { number: 999 }), { repository: "jedbjorn/storybench", number: 999, found: false, reason: "No issue #999 exists in jedbjorn/storybench" });
  const pull = await call("read_upstream_issue", { number: 125 });
  assert.equal(pull.found, false); assert.match(pull.reason, /pull request/);
});

const rpc = (socketPath, token, message) => new Promise((resolve, reject) => {
  const socket = connect(socketPath); let buffer = "";
  socket.on("connect", () => socket.write(JSON.stringify({ token, ...message }) + "\n"));
  socket.on("data", (data) => { buffer += data; });
  socket.on("end", () => resolve(JSON.parse(buffer)));
  socket.on("error", reject);
});

for (const kind of ["deck", "video"]) test(`C6: Codex, Claude and OpenCode each list and can call the three tools in a ${kind} production`, async (t) => {
  const { app, github, upstream, scope, rows } = await fixture(t, { kind });
  github.state.issues.set(98, issue(98, "Deck export drops the last slide"));
  const chatHandlers = Object.fromEntries(STORYBENCH_TOOLS.map(({ name }) => [name, () => ({})]));
  const dir = await mkdtemp(path.join(os.tmpdir(), "sb-upstream-route-")); t.after(() => rm(dir, { recursive: true, force: true }));
  for (const harness of ["codex", "claude", "opencode"]) for (const supportsImages of [true, false]) {
    // The request's own assembly: scoped runtime tools, merged with the chat's operations, filtered by saved kind.
    const scoped = createScopedTools(scope(harness), { store: app.store, upstream });
    const tools = selectKindTools(mergeTools(scoped, chatHandlers), kind, { supportsImages });
    scoped.setServedDefinitions(tools.definitions);
    const title = `${kind} ${harness} ${supportsImages}`;
    const inputs = { find_upstream_issues: { query: "export" }, prepare_upstream_report: { kind: "feature", title, body: "Body" }, read_upstream_issue: { number: 98 } };
    let listed, callTool;
    const bridge = await startBridge({ socketPath: path.join(dir, "bridge.sock"), token: "k".repeat(64), tools });
    try {
      if (harness === "codex") {
        const codex = new WorkerCodexConnection({ child: {}, tools, dynamicTools: true });
        listed = codex.dynamicTools.map(({ type, ...definition }) => definition);
        callTool = async (name) => (await codex.tools[name](inputs[name]))[Symbol.for("storybench.codex.toolContent")][0].text;
      } else {
        // Both stdio MCP adapters forward to this same request bridge.
        listed = (await rpc(path.join(dir, "bridge.sock"), "k".repeat(64), { op: "tools/list" })).result.tools;
        callTool = async (name) => {
          const { result } = await rpc(path.join(dir, "bridge.sock"), "k".repeat(64), { op: "tools/call", name, arguments: inputs[name] });
          assert.notEqual(result.isError, true, result.content[0].text);
          return result.content[0].text;
        };
      }
      assert.deepEqual(listed.filter(({ name }) => NAMES.includes(name)), [...UPSTREAM_DEFINITIONS], `${harness} lists the three tools`);
      const found = JSON.parse(await callTool("find_upstream_issues"));
      assert.equal(found.checked, true); assert.equal(found.matches[0].number, 98);
      const prepared = JSON.parse(await callTool("prepare_upstream_report"));
      assert.equal(app.store.getUpstreamReport(prepared.reportId).title, title);
      const read = JSON.parse(await callTool("read_upstream_issue"));
      assert.equal(read.found, true); assert.equal(read.title, "Deck export drops the last slide");
      // get_capabilities reports them among this request's served tools.
      const capabilities = JSON.parse((await tools.call("get_capabilities", {})).text);
      for (const name of NAMES) assert.ok(capabilities.tools.some((tool) => tool.name === name), name);
    } finally { await bridge.close(); await scoped.close(); }
  }
  assert.equal(rows().length, 6);
  assert.ok(rows().every((row) => row.episode_id === scope().episodeId && row.conversation_id === scope().conversationId && row.request_id === "request_one"));
});

// C10 is the Reviewer's reading of the skill. This keeps the mechanical parts true: the skill
// and its one boot pointer reach every harness root for both kinds, and name real tools and addresses.
for (const kind of ["deck", "video"]) test(`the report skill and its boot pointer render for a ${kind} production on every harness root`, async (t) => {
  const { app, episode, conversation } = await fixture(t, { kind });
  const templates = await loadTemplates(undefined, kind);
  const episodeDir = await mkdtemp(path.join(os.tmpdir(), "sb-upstream-boot-")); t.after(() => rm(episodeDir, { recursive: true, force: true }));
  const built = defaultBootContextFor(app.store, { episodeId: episode.id, conversationId: conversation.id, model: "sonnet", harness: "claude", request: { text: "Report this upstream", messageId: 1 } })({ served: NAMES });
  await renderEpisodeBoot({ episodeDir, templates, kind, context: { ...built, paths: { ...built.paths, episode: episodeDir, work: path.join(episodeDir, "work") } } });
  const boot = await readFile(path.join(episodeDir, "AGENTS.md"), "utf8");
  assert.equal(boot, await readFile(path.join(episodeDir, "CLAUDE.md"), "utf8"));
  const pointers = boot.split("\n").filter((line) => line.includes("`storybench-report-upstream`"));
  assert.equal(pointers.length, 1, "one boot line points to the skill");
  assert.match(pointers[0], /^\*\*Reporting to the Storybench project\.\*\* When the creator asks to report .* read the `storybench-report-upstream` skill first\. You prepare the report; only the creator submits it\.$/);
  assert.equal(boot.split("\n")[boot.split("\n").indexOf(pointers[0]) + 2], "## Reporting", "the pointer sits beside the reporting rule");
  assert.ok(boot.includes(".claude/skills/storybench-report-upstream/SKILL.md"), "the boot indexes the skill");
  const skills = await Promise.all([".claude/skills", ".agents/skills", ".opencode/skills"].map((root) => readFile(path.join(episodeDir, root, "storybench-report-upstream/SKILL.md"), "utf8")));
  assert.ok(skills.every((skill) => skill === skills[0]));
  const skill = skills[0];
  assert.ok(!/\{\{/.test(skill));
  for (const name of NAMES) assert.ok(skill.includes(`\`${name}\``), `the skill names ${name}`);
  assert.ok(skill.includes(`<${UPSTREAM.securityAdvisory}>`), "the skill's advisory address is the fixed one");
  assert.deepEqual(skill.match(/https?:\/\/[^\s>)]+/g), [UPSTREAM.securityAdvisory], "the skill names no other address");
});
