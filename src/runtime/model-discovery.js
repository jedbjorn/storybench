// Host-side model discovery for the harness/model picker (spec #11 "Selection and
// availability"). Availability always comes first from the live credential
// (harnessAvailability, decision #43): no usable login means the harness and its models are
// unavailable with a plain reason; nothing is served from a cache in that case.
//  - Codex: native discovery. A short-lived, unprivileged worker-image container runs
//    `codex app-server` with a per-discovery staged credential copy and answers `model/list`
//    (ids, display names, default model, per-model supported reasoning efforts).
//  - Claude Code: no native model listing exists in the installed CLI. The installed CLI's
//    own `--help` supplies the model aliases it documents and the `--effort` levels; these
//    are labelled advisory (an alias is not proof of account access), and exact model IDs
//    are accepted and validated on first use.
import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { CredentialLink, harnessAvailability } from "./credentials.js";
import { CREDENTIAL_TARGETS, LABEL, SESSION_MOUNT, names } from "./layout.js";
import { RuntimeError } from "./validate.js";

export const CATALOG_STALE_MS = 6 * 60 * 60 * 1000;

// model/list result -> picker entries.
export function parseCodexModelList(result) {
  const data = Array.isArray(result?.data) ? result.data : [];
  return data.filter((model) => !model.hidden).map((model) => ({
    id: String(model.model || model.id),
    displayName: model.displayName || String(model.model || model.id),
    description: model.description || "",
    isDefault: Boolean(model.isDefault),
    efforts: (model.supportedReasoningEfforts || []).map((option) => (typeof option === "string" ? option : option.reasoningEffort)).filter(Boolean),
    defaultEffort: model.defaultReasoningEffort || null,
    inputModalities: model.inputModalities || null,
  }));
}

// `claude --help` -> documented aliases and effort levels.
export function parseClaudeHelp(text) {
  const flat = String(text).replace(/\s+/g, " ");
  const modelHelp = /--model <model>(.*?)(?= --[a-z])/.exec(flat)?.[1] ?? "";
  const aliases = [...new Set([...modelHelp.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((match) => match[1]))];
  const effortHelp = /--effort <level>(.*?)(?= --[a-z])/.exec(flat)?.[1] ?? "";
  const efforts = /\(([a-z, ]+)\)/.exec(effortHelp)?.[1]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return { aliases, efforts };
}

function collect(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new RuntimeError("DISCOVERY_TIMEOUT", "Model discovery timed out")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// Run `codex app-server` in a throwaway container and ask it for its model list.
async function codexModelList({ config, stageRoot, spawn, timeoutMs }) {
  await mkdir(stageRoot, { recursive: true, mode: 0o700 });
  const stageDir = await mkdtemp(path.join(stageRoot, "discovery-"));
  let link;
  try {
    link = await CredentialLink.stage({ harness: "codex", hostPath: config.credentials.codex, stageDir });
    const n = names(config.installId);
    const args = ["run", "--rm", "-i", "--label", `${LABEL.install}=${config.installId}`, "--label", `${LABEL.role}=discovery`,
      "--user", "0:0", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--init", "--read-only",
      "--tmpfs", "/tmp:exec,mode=1777", "--tmpfs", "/storybench/home:mode=0700", "--tmpfs", `${SESSION_MOUNT}/codex:mode=0700`,
      "--network", n.workerNetwork,
      "--mount", `type=bind,source=${link.stagePath},target=${CREDENTIAL_TARGETS.codex}`,
      config.images.worker, "codex", "app-server", "--listen", "stdio://"];
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new RuntimeError("DISCOVERY_TIMEOUT", "Codex model discovery timed out")); }, timeoutMs);
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); reject(new RuntimeError("DISCOVERY_FAILED", `Codex exited before listing models (${code}): ${stderr.trim().slice(-300)}`)); });
      lines.on("line", (line) => {
        let message; try { message = JSON.parse(line); } catch { return; }
        if (message.id === 1 && !message.error) {
          child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
          child.stdin.write(JSON.stringify({ id: 2, method: "model/list", params: { includeHidden: false, limit: 100 } }) + "\n");
        } else if (message.id === 2 || (message.id === 1 && message.error)) {
          clearTimeout(timer);
          child.removeAllListeners("close");
          child.stdin.end();
          child.kill("SIGTERM");
          if (message.error) reject(new RuntimeError("DISCOVERY_FAILED", `Codex model/list failed: ${JSON.stringify(message.error).slice(0, 300)}`));
          else resolve(message.result);
        }
      });
      child.stdin.write(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "storybench-discovery", version: "0.1.0" }, capabilities: { experimentalApi: true } } }) + "\n");
    });
    return parseCodexModelList(result);
  } finally {
    if (link) { await link.sync().catch(() => {}); await link.dispose().catch(() => {}); }
    await rm(stageDir, { recursive: true, force: true });
  }
}

async function claudeCliCatalog({ config, spawn, timeoutMs }) {
  const child = spawn("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--read-only", "--tmpfs", "/storybench/home:mode=0700",
    "--label", `${LABEL.install}=${config.installId}`, "--label", `${LABEL.role}=discovery`, config.images.worker, "claude", "--help"], { stdio: ["ignore", "pipe", "pipe"] });
  const { code, stdout, stderr } = await collect(child, timeoutMs);
  if (code !== 0) throw new RuntimeError("DISCOVERY_FAILED", `claude --help failed (${code}): ${stderr.trim().slice(-300)}`);
  return parseClaudeHelp(stdout);
}

export function createModelDiscovery({ config, stageRoot, spawn = nodeSpawn, now = Date.now, timeoutMs = 60_000 }) {
  const cache = new Map(), pending = new Map();
  async function discover(harness, { refresh = false } = {}) {
    const availability = (await harnessAvailability(config.credentials))[harness];
    if (!availability?.available) return { harness, available: false, reason: availability?.reason ?? "Unknown harness", models: [], source: null, fetchedAt: null, stale: false };
    const cached = cache.get(harness);
    if (cached && !refresh) return { ...cached, cached: true, stale: now() - cached.fetchedAtMs > CATALOG_STALE_MS };
    if (pending.has(harness)) return pending.get(harness);
    const task = (async () => {
      let entry;
      try {
        if (harness === "codex") {
          const models = await codexModelList({ config, stageRoot, spawn, timeoutMs });
          entry = { harness, available: true, reason: null, source: "native", advisory: false, exactModelIds: true, models, efforts: null };
        } else {
          const { aliases, efforts } = await claudeCliCatalog({ config, spawn, timeoutMs });
          entry = { harness, available: true, reason: null, source: "installed-cli-help", advisory: true, exactModelIds: true,
            note: "Aliases documented by the installed Claude Code CLI; an alias is not proof of account access. Exact model IDs are accepted and verified on first use.",
            models: aliases.map((alias) => ({ id: alias, displayName: alias, description: "CLI alias (advisory)", isDefault: false, efforts, defaultEffort: null })), efforts };
        }
      } catch (error) {
        // Discovery failure is reported plainly; a previous successful list is shown as stale.
        if (cached) return { ...cached, cached: true, stale: true, discoveryError: error.message };
        return { harness, available: true, reason: null, models: [], source: null, fetchedAt: null, stale: true, exactModelIds: true, discoveryError: error.message };
      }
      const fetchedAtMs = now();
      const stored = { ...entry, fetchedAt: new Date(fetchedAtMs).toISOString(), fetchedAtMs };
      cache.set(harness, stored);
      return { ...stored, cached: false, stale: false };
    })();
    pending.set(harness, task);
    try { return await task; }
    finally { if (pending.get(harness) === task) pending.delete(harness); }
  }
  return { discover };
}
