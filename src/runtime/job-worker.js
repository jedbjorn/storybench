// Agent job workers (spec #42 'Run'). A job is one headless harness run in its own worker,
// launched through the host control socket with the job id in place of a request id. It
// never takes the production's render claim: its boot is rendered into its pad, never the
// production directory, and it is served only read-only Storybench tools.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createResearchContext } from "../research-context.js";
import { createProductionReadTools } from "../production-read-tools.js";
import { defaultBootContextFor, mergeTools } from "./app-runtime.js";
import { DEFAULT_TEMPLATES, SKILL_ROOTS, renderEpisodeBoot } from "./boot.js";
import { selectKindTools } from "./kinds.js";
import { openHeldRequest } from "./request.js";
import { RuntimeError } from "./validate.js";

// Exactly the tools of spec #42 'Tools'; a production kind serves those it has.
export const JOB_TOOLS = Object.freeze([
  "get_context", "read_research", "read_deck", "read_reference_excerpt",
  "inspect_image", "get_capabilities", "get_operation_guide", "get_job",
]);

export function selectJobTools(tools, kind, options = {}) {
  const kindTools = selectKindTools(tools, kind, options);
  const definitions = kindTools.definitions.filter(({ name }) => JOB_TOOLS.includes(name));
  const served = new Set(definitions.map(({ name }) => name));
  return {
    definitions,
    async call(name, args = {}) {
      if (!served.has(name)) throw new RuntimeError("UNKNOWN_TOOL", `Agent jobs only read; ${String(name)} is unavailable to a job`, { status: 404 });
      return kindTools.call(name, args);
    },
  };
}

export const JOB_TEMPLATE = path.join(DEFAULT_TEMPLATES, "job", "BOOT.md");

// Render a job's instructions (AGENTS.md, CLAUDE.md, .opencode/.gitignore) into its pad. The
// production's skills are listed by their rendered path in the production directory.
export async function renderJobBoot({ padDir, episodeDir, templates, context, template = JOB_TEMPLATE }) {
  const boot = await readFile(template, "utf8");
  const skills = templates.skills.map((skill) => `  - **${skill.name}**: ${skill.description} (\`${path.join(episodeDir, SKILL_ROOTS.claude, skill.name, "SKILL.md")}\`)`).join("\n") || "  - (no skills shipped)";
  const version = createHash("sha256").update(JSON.stringify({ job: boot, production: templates.version })).digest("hex");
  return renderEpisodeBoot({ episodeDir: padDir, kind: templates.kind, templates: { kind: templates.kind, boot, skills: [], version },
    context: { ...context, production: { skills } } });
}

// The read-only Storybench handlers of one job (the runtime tools add inspect_image,
// get_capabilities and read_reference_excerpt).
export function jobReadTools({ store, renders, decks, job }) {
  const episode = store.getEpisode(job.episodeId);
  const read = createProductionReadTools({ store, renders, decks, episodeId: job.episodeId, brandStandards: store.getBrandStandards(episode.channelId) });
  const research = createResearchContext({ store, episodeId: job.episodeId, assertActive: () => {} });
  return { ...read, read_research: () => research.read() };
}

// The production launcher behind the agent job runner (src/agent-jobs.js): opens the job's
// worker and returns its harness connection. Closing the connection removes the worker.
export function createJobWorkerLauncher({ store, controlSocket, renders, decks, library = null, release = null }) {
  return async function launchJobWorker(job, { onEvent, onError, supportsImages = true }) {
    const request = await openHeldRequest({
      controlSocket, store, requestId: job.id, conversationId: job.conversationId, harness: job.harness, source: job.source,
      segmentId: job.segmentId, episodeId: job.episodeId, model: job.model, supportsImages, library, release, pad: job.padPath,
      bootContext: (values) => {
        const context = defaultBootContextFor(store, { episodeId: job.episodeId, conversationId: job.conversationId, model: job.model, effort: job.effort, harness: job.harness,
          request: { text: job.brief, kind: "agent_job" } })(values);
        return { ...context, job: { id: job.id, label: job.label, timeLimitMinutes: job.timeLimitMinutes }, paths: { ...context.paths, pad: job.padPath } };
      },
      wrapTools: (runtimeTools) => mergeTools(runtimeTools, jobReadTools({ store, renders, decks, job })),
      selectTools: selectJobTools,
      renderBoot: ({ context, templates }) => renderJobBoot({ padDir: job.padPath, episodeDir: store.episodeLocation(job.episodeId).directory, templates, context }),
    });
    let connection;
    try {
      connection = job.harness === "codex" ? await request.codex({ model: job.model, effort: job.effort, onEvent, onError, requestTimeout: 60_000 })
        : job.harness === "opencode" ? await request.openCodeConnection({ model: job.model, effort: job.effort, onEvent, onError }).open()
        : await request.claudeConnection({ model: job.model, effort: job.effort, onEvent, onError }).open();
    } catch (error) { await request.stop().catch(() => {}); throw error; }
    const close = connection.close.bind(connection);
    let stopping;
    connection.close = () => { close(); return (stopping ||= request.stop()); };
    return connection;
  };
}
