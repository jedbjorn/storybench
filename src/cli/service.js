// Service state for the lifecycle commands: the user unit's state plus the app's /api/health, checked against the
// expected release and data-root identity. A PID, container state or successful systemd start alone is not health.
import http from "node:http";

export function requestJson(port, pathName, { method = "GET", body = null, timeoutMs = 3000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const request = http.request({ host: "127.0.0.1", port, path: pathName, method, timeout: timeoutMs, agent: false,
      headers: { host: `127.0.0.1:${port}`, ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}), ...headers } }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { if (text.length < 1_000_000) text += chunk; });
      response.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: response.statusCode, json });
      });
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

const isHealth = (value) => value && typeof value === "object" && typeof value.status === "string" && value.database && value.schema;

// running: a Storybench app answers (health may still be starting) | other: another program | stopped | unreachable
export async function probeService(port, { timeoutMs = 1500 } = {}) {
  try {
    const health = await requestJson(port, "/api/health", { timeoutMs });
    if (isHealth(health.json)) return { state: "running", health: health.json, dataRootId: health.json.database.id, schemaVersion: health.json.schema.current };
    const identity = await requestJson(port, "/api/data-root", { timeoutMs });
    if (identity.status === 200 && typeof identity.json?.id === "string" && Number.isInteger(identity.json?.schemaVersion))
      return { state: "running", health: null, dataRootId: identity.json.id, schemaVersion: identity.json.schemaVersion };
    return { state: "other" };
  } catch (error) {
    return { state: error.code === "ECONNREFUSED" ? "stopped" : "unreachable" };
  }
}

// Differences between what answers and what this installation expects.
export function healthProblems(health, { identity = null, dataRootId = null } = {}) {
  const problems = [];
  if (!health) return ["the service did not report health"];
  if (dataRootId && health.database?.id !== dataRootId) problems.push("it serves a different data root than the configured one");
  if (identity) {
    const release = health.release || {};
    if (release.manifestId !== identity.manifestId) problems.push(`it runs release ${release.manifestId ?? "(none)"}, not ${identity.manifestId}`);
    if (release.commit !== identity.commit) problems.push(`it runs commit ${release.commit ?? "(unknown)"}, not ${identity.commit}`);
    if (release.images?.app !== identity.images.app || release.images?.worker !== identity.images.worker) problems.push("its app/worker images differ from the release");
  }
  if (health.schema && health.schema.current > health.schema.supported?.max) problems.push(`its database schema ${health.schema.current} is newer than it supports`);
  return problems;
}

export const activeWork = (health) => {
  const renders = (health?.activity?.renders?.queued ?? 0) + (health?.activity?.renders?.running ?? 0);
  const agents = health?.activity?.agents?.active ?? 0;
  return { renders, agents, busy: renders + agents > 0 };
};

// Combined view: stopped | starting | healthy | failed | stopping, plus details for status and the other commands.
export async function serviceStatus({ system, unit, port, identity = null, dataRootId = null, probe = probeService }) {
  let unitState;
  try { unitState = await system.unitState(unit); }
  catch (error) { unitState = { load: "unknown", active: "unknown", error: error.message }; }
  const answer = await probe(port);
  const health = answer.state === "running" ? answer.health : null;
  const problems = health ? healthProblems(health, { identity, dataRootId }) : [];
  let state;
  if (unitState.active === "failed") state = "failed";
  else if (unitState.active === "deactivating") state = "stopping";
  else if (unitState.active === "activating" || unitState.active === "reloading") state = "starting";
  else if (unitState.active === "active") state = health?.ready && !problems.length ? "healthy" : health?.ready ? "mismatched" : "starting";
  else state = "stopped";
  return { state, unit: unitState, answer, health, problems, port };
}
