// Health snapshot for GET /api/health (spec #10 "Health and Lifecycle").
// Bounded runtime facts only: never credentials, prompts, story text, media names, channel
// names or filesystem paths. Activity counts are aggregated across ALL channels; the
// viewed channel never scopes them.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "../store.js";
import { MIN_SUPPORTED_SCHEMA } from "./manifest.js";

const PACKAGE = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"));

// The host passes the release identity (from the validated manifest) in this env var.
export function releaseFromEnv(env = process.env) {
  try {
    const value = JSON.parse(env.STORYBENCH_RELEASE || "null");
    if (!value || typeof value !== "object") return null;
    const pick = (text, max = 80) => (typeof text === "string" && text.length <= max ? text : null);
    return {
      manifestId: pick(value.manifestId), version: pick(value.version), commit: pick(value.commit),
      images: { app: pick(value.images?.app), worker: pick(value.images?.worker) },
      protocol: Number.isInteger(value.protocol) ? value.protocol : null,
    };
  } catch { return null; }
}

function count(db, sql) {
  try { return Number(db.prepare(sql).get()?.n ?? 0); } catch { return 0; }
}

export function createHealth({ store, getState = () => "ready", release = releaseFromEnv() }) {
  return {
    snapshot() {
      const state = getState();
      const db = store.db;
      const identity = store.dataRootIdentity?.() ?? null;
      return {
        status: state,
        ready: state === "ready",
        shuttingDown: state === "draining" || state === "stopped",
        package: { name: PACKAGE.name, version: PACKAGE.version },
        release: release ?? { manifestId: null, version: null, commit: null, images: { app: null, worker: null }, protocol: null },
        schema: { current: Number(db.prepare("PRAGMA user_version").get().user_version), supported: { min: MIN_SUPPORTED_SCHEMA, max: SCHEMA_VERSION } },
        database: { id: identity?.id ?? null },
        activity: {
          renders: {
            queued: count(db, "SELECT COUNT(*) n FROM jobs WHERE state='queued'"),
            running: count(db, "SELECT COUNT(*) n FROM jobs WHERE state IN ('running','cancelling')"),
          },
          agents: {
            active: count(db, "SELECT COUNT(*) n FROM conversations WHERE state IN ('queued','running','interrupting')"),
          },
        },
        checkedAt: new Date().toISOString(),
      };
    },
  };
}
