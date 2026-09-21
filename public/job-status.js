export async function refreshJobStatus(api, getCurrentState, url = "/api/state") {
  const incoming = await api(url);
  return { ...getCurrentState(), jobs: incoming.jobs };
}

const ASSEMBLED = ["draft", "legacy_draft", "final"];
// Current designation decides the view; the original production class stays visible in the title.
const designationOf = (job) => job.designation ?? (job.outputClass === "final" ? "final" : null);
const isDeleted = (job) => (job.deletionState ?? "present") !== "present";

export function jobsForOutputView(jobs, view) {
  if (view === "final") return jobs.filter((job) => designationOf(job) === "final");
  return jobs.filter((job) => designationOf(job) !== "final");
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function jobTitle(job) {
  if (!(job.state === "completed" && ASSEMBLED.includes(job.outputClass))) return job.kind;
  const produced = job.outputClass === "final" ? "Final" : job.outputClass === "legacy_draft" ? "Legacy Draft" : "Draft";
  const label = designationOf(job) === "draft" && job.outputClass === "final" ? "Draft (rendered as Final)" : produced;
  return `${job.deletionState === "deleted" ? "Deleted " : ""}${label} — ${new Date(job.createdAt).toLocaleString()}`;
}

// Stop and detach a player so the browser releases its file handle; other players are untouched.
export function releasePlayer(video) {
  if (!video) return;
  video.pause?.();
  video.removeAttribute("src");
  video.load?.();
  video.remove();
}

function updateJobRow(element, job) {
  const completedOutput = job.state === "completed" && ASSEMBLED.includes(job.outputClass) && !isDeleted(job);
  element.querySelector("[data-job-title]").textContent = jobTitle(job);
  element.querySelector("[data-job-meta]").textContent = ` · revision ${job.revision}${job.stale === true ? " · out of date" : ""}`;
  const status = element.querySelector("[data-job-status]");
  status.className = job.state === "failed" ? "failed" : "";
  status.textContent = job.deletionState === "deleted"
    ? `deleted${job.deletedBytes ? ` · ${formatBytes(job.deletedBytes)} reclaimed` : ""}${job.deletionNote ? ` · ${job.deletionNote}` : ""}`
    : job.deletionState === "deleting" ? "deleting…"
      : `${job.error || job.state} ${job.state === "running" ? Math.round(job.progress * 100) + "%" : ""}${job.deletionNote ? ` · ${job.deletionNote}` : ""}`;
  const media = element.querySelector("[data-job-media]");
  const source = `/api/jobs/${encodeURIComponent(job.id)}/file`;
  const video = media.querySelector("video");
  if (completedOutput && !video) {
    const player = element.ownerDocument.createElement("video");
    player.controls = true; player.preload = "metadata"; player.src = source;
    player.style.cssText = "display:block;max-width:420px;width:100%;margin-top:8px";
    media.append(player);
  } else if (!completedOutput && video) releasePlayer(video);
  else if (video && video.getAttribute("src") !== source) video.setAttribute("src", source);
  const actions = element.querySelector("[data-job-actions]");
  const actionKey = `${job.state}:${job.id}:${designationOf(job)}:${job.deletionState ?? "present"}:${job.recordRevision ?? ""}`;
  if (actions.dataset.actionKey !== actionKey) {
    actions.replaceChildren();
    const button = (text, data) => { const value = element.ownerDocument.createElement("button"); value.textContent = text; Object.assign(value.dataset, data); return value; };
    if (["queued", "running"].includes(job.state)) {
      const cancel = element.ownerDocument.createElement("button"); cancel.dataset.cancelJob = job.id; cancel.textContent = "Cancel"; actions.append(cancel);
    }
    if (completedOutput && designationOf(job) === "final")
      actions.append(button("Move to Drafts", { moveToDrafts: job.id, revision: String(job.recordRevision ?? 1) }));
    if (completedOutput && designationOf(job) === "draft")
      actions.append(button("Delete", { deleteOutput: job.id, revision: String(job.recordRevision ?? 1) }));
    if (job.state === "completed" && !isDeleted(job)) {
      const link = element.ownerDocument.createElement("a"); link.href = source; link.target = "_blank";
      const open = element.ownerDocument.createElement("button"); open.textContent = "Open"; link.append(open); actions.append(link);
    }
    actions.dataset.actionKey = actionKey;
  }
}

function jobRow(document, job) {
  const element = document.createElement("div");
  element.className = "job";
  element.dataset.jobId = job.id;
  element.innerHTML = '<div><b data-job-title></b><span data-job-meta></span><br><span data-job-status></span><span data-job-media></span></div><div data-job-actions></div>';
  updateJobRow(element, job);
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
  const wanted = new Set(jobs.map((job) => String(job.id)));
  let position = container.firstElementChild;
  for (const job of jobs) {
    const row = existing.get(String(job.id)) || jobRow(container.ownerDocument, job);
    updateJobRow(row, job);
    if (row === position) position = position.nextElementSibling;
    else container.insertBefore(row, position);
  }
  for (const child of [...container.children]) if (!wanted.has(child.dataset.jobId)) child.remove();
}
