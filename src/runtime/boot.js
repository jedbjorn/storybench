// Episode boot/skill renderer (spec #11 "Runtime episode renders", decision #38).
// Renders one orientation body into AGENTS.md and CLAUDE.md in the episode directory and
// each shipped skill into the native discovery directories of both harnesses, atomically,
// before a worker starts or resumes. A manifest records what the app rendered, so a later
// render removes only obsolete app-owned files and never touches story/media/work or
// user files. Template content is owned by the boot/skills lane; this is the mechanism.
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_TEMPLATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../agent");
export const MANIFEST = ".storybench/renders.json";
// Native skill discovery roots, verified against the installed harnesses:
// Claude Code 2.1.278 reads <cwd>/.claude/skills; Codex 0.155.1 lists <cwd>/.agents/skills
// (and .codex/skills) as repo-scope skills via skills/list.
export const SKILL_ROOTS = Object.freeze({ claude: ".claude/skills", codex: ".agents/skills" });
const BOOT_FILES = ["AGENTS.md", "CLAUDE.md"];
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function lookup(context, key) {
  let value = context;
  for (const part of key.split(".")) {
    if (value == null || !Object.hasOwn(Object(value), part)) return undefined;
    value = value[part];
  }
  return value;
}

export function fillTemplate(source, context, name = "template") {
  return source.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (match, key) => {
    const value = lookup(context, key);
    if (value === undefined || value === null) throw new Error(`${name}: no value for {{${key}}}`);
    return Array.isArray(value) ? value.join(", ") : String(value);
  });
}

function frontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const fields = {};
  if (match) for (const line of match[1].split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const existing = await lstat(file).catch(() => null);
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new Error(`Refusing to replace non-file render target ${file}`);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(temp, content, { mode: 0o644, flag: "wx" });
  try { await rename(temp, file); }
  catch (error) { await unlink(temp).catch(() => {}); throw error; }
}

export async function loadTemplates(templatesDir = DEFAULT_TEMPLATES) {
  const boot = await readFile(path.join(templatesDir, "BOOT.md"), "utf8");
  const skills = [];
  const entries = await readdir(path.join(templatesDir, "skills"), { withFileTypes: true }).catch(() => []);
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const source = await readFile(path.join(templatesDir, "skills", entry.name, "SKILL.md"), "utf8");
    const meta = frontmatter(source);
    if (!SKILL_NAME.test(meta.name ?? "")) throw new Error(`Skill template ${entry.name} needs a lowercase frontmatter name`);
    skills.push({ name: meta.name, description: meta.description ?? "", source });
  }
  const version = sha256(JSON.stringify({ boot, skills: skills.map((skill) => [skill.name, skill.source]) }));
  return { boot, skills, version };
}

// context: values for {{...}} placeholders (channel, episode, paths, runtime, ...).
export async function renderEpisodeBoot({ episodeDir, context, templates }) {
  const loaded = templates ?? await loadTemplates();
  const skillIndex = loaded.skills.map((skill) =>
    `- **${skill.name}**: ${skill.description} (Claude: \`${SKILL_ROOTS.claude}/${skill.name}/SKILL.md\`, Codex: \`${SKILL_ROOTS.codex}/${skill.name}/SKILL.md\`)`).join("\n") || "- (no skills shipped)";
  const fullContext = { ...context, skills: { index: skillIndex } };
  const header = `<!-- storybench:rendered template=${loaded.version.slice(0, 16)} — regenerated before each agent start/resume; edits are overwritten. -->\n`;
  const body = header + fillTemplate(loaded.boot, fullContext, "BOOT.md");
  const outputs = new Map();
  for (const file of BOOT_FILES) outputs.set(file, body);
  for (const skill of loaded.skills) {
    const rendered = fillTemplate(skill.source, fullContext, `skill ${skill.name}`);
    for (const root of Object.values(SKILL_ROOTS)) outputs.set(`${root}/${skill.name}/SKILL.md`, rendered);
  }

  const manifestPath = path.join(episodeDir, MANIFEST);
  const previous = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "{}"));
  const files = [];
  for (const [relative, content] of outputs) {
    await atomicWrite(path.join(episodeDir, relative), content);
    files.push({ path: relative, sha256: sha256(content) });
  }
  // Remove only files this renderer previously wrote that are no longer rendered.
  const removed = [];
  for (const old of previous.files ?? []) {
    if (typeof old?.path !== "string" || outputs.has(old.path)) continue;
    const isSkill = Object.values(SKILL_ROOTS).some((root) => old.path.startsWith(`${root}/`) && old.path.endsWith("/SKILL.md") && old.path.split("/").length === 4);
    if (!isSkill && !BOOT_FILES.includes(old.path)) continue;
    const target = path.join(episodeDir, old.path);
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile()) continue;
    await unlink(target);
    await rmdir(path.dirname(target)).catch(() => {});
    removed.push(old.path);
  }
  const manifest = { renderedAt: new Date().toISOString(), templateVersion: loaded.version, bootSha256: sha256(body), files };
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { ...manifest, removed, manifestPath };
}
