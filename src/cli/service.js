// Seam for "is Storybench running?". Task #15 replaces this with the real user-service status; until then a
// loopback probe of the configured port distinguishes a Storybench service, another listener, and nothing.
import http from "node:http";

export function probeService(port, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/api/data-root", timeout: timeoutMs, agent: false, headers: { host: `127.0.0.1:${port}` } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { if (body.length < 65536) body += chunk; });
      response.on("end", () => {
        try {
          const value = JSON.parse(body);
          if (response.statusCode === 200 && typeof value?.id === "string" && Number.isInteger(value?.schemaVersion))
            return resolve({ state: "running", dataRootId: value.id, schemaVersion: value.schemaVersion, pid: value.pid ?? null });
        } catch { /* not Storybench */ }
        resolve({ state: "other" });
      });
    });
    request.on("timeout", () => { request.destroy(); resolve({ state: "unreachable" }); });
    request.on("error", (error) => resolve({ state: error.code === "ECONNREFUSED" ? "stopped" : "unreachable" }));
  });
}
