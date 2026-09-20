export async function refreshJobStatus(api, getCurrentState) {
  const incoming = await api("/api/state");
  return { ...getCurrentState(), jobs: incoming.jobs };
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const displayKey = (job) => JSON.stringify([job.kind, job.state, job.progress, job.revision, job.outputClass, job.createdAt, job.stale, job.error]);

function jobRow(document, job) {
  const completedOutput = job.state === "completed" && ["draft", "final"].includes(job.outputClass);
  const title = completedOutput
    ? `${job.outputClass === "final" ? "Final" : "Draft"} — ${new Date(job.createdAt).toLocaleString()}`
    : job.kind;
  const element = document.createElement("div");
  element.className = "job";
  element.dataset.jobId = job.id;
  element.dataset.jobDisplay = displayKey(job);
  element.innerHTML = `<div><b>${escapeHtml(title)}</b> · revision ${job.revision}${job.stale === true ? " · out of date" : ""}<br><span class="${job.state === "failed" ? "failed" : ""}">${escapeHtml(job.error || job.state)} ${job.state === "running" ? Math.round(job.progress * 100) + "%" : ""}</span>${completedOutput ? `<video controls preload="metadata" src="/api/jobs/${escapeHtml(job.id)}/file" style="display:block;max-width:420px;width:100%;margin-top:8px"></video>` : ""}</div><div>${["queued", "running"].includes(job.state) ? `<button data-cancel-job="${escapeHtml(job.id)}">Cancel</button>` : ""}${job.state === "completed" ? `<a href="/api/jobs/${escapeHtml(job.id)}/file" target="_blank"><button>Open</button></a>` : ""}</div>`;
  return element;
}

export function renderJobList(container, jobs) {
  const existing = new Map([...container.querySelectorAll(":scope > [data-job-id]")].map((element) => [element.dataset.jobId, element]));
  if (!jobs.length) {
    if (container.children.length !== 1 || container.firstElementChild?.dataset.emptyJobs !== "true") {
      const empty = container.ownerDocument.createElement("p"); empty.dataset.emptyJobs = "true"; empty.textContent = "No renders yet."; container.replaceChildren(empty);
    }
    return;
  }
  const rows = jobs.map((job) => {
    const prior = existing.get(String(job.id));
    return prior?.dataset.jobDisplay === displayKey(job) ? prior : jobRow(container.ownerDocument, job);
  });
  container.replaceChildren(...rows);
}
