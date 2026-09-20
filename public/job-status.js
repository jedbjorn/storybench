export async function refreshJobStatus(api, getCurrentState) {
  const incoming = await api("/api/state");
  return { ...getCurrentState(), jobs: incoming.jobs };
}

export function jobsForOutputView(jobs, view) {
  if (view === "final") return jobs.filter((job) => job.outputClass === "final");
  return jobs.filter((job) => job.outputClass !== "final");
}

function jobTitle(job) {
  const completedOutput = job.state === "completed" && ["draft", "legacy_draft", "final"].includes(job.outputClass);
  return completedOutput
    ? `${job.outputClass === "final" ? "Final" : job.outputClass === "legacy_draft" ? "Legacy Draft" : "Draft"} — ${new Date(job.createdAt).toLocaleString()}`
    : job.kind;
}

function updateJobRow(element, job) {
  const completedOutput = job.state === "completed" && ["draft", "legacy_draft", "final"].includes(job.outputClass);
  element.querySelector("[data-job-title]").textContent = jobTitle(job);
  element.querySelector("[data-job-meta]").textContent = ` · revision ${job.revision}${job.stale === true ? " · out of date" : ""}`;
  const status = element.querySelector("[data-job-status]");
  status.className = job.state === "failed" ? "failed" : "";
  status.textContent = `${job.error || job.state} ${job.state === "running" ? Math.round(job.progress * 100) + "%" : ""}`;
  const media = element.querySelector("[data-job-media]");
  const source = `/api/jobs/${encodeURIComponent(job.id)}/file`;
  const video = media.querySelector("video");
  if (completedOutput && !video) {
    const player = element.ownerDocument.createElement("video");
    player.controls = true; player.preload = "metadata"; player.src = source;
    player.style.cssText = "display:block;max-width:420px;width:100%;margin-top:8px";
    media.append(player);
  } else if (!completedOutput && video) video.remove();
  else if (video && video.getAttribute("src") !== source) video.setAttribute("src", source);
  const actions = element.querySelector("[data-job-actions]");
  const actionKey = `${job.state}:${job.id}`;
  if (actions.dataset.actionKey !== actionKey) {
    actions.replaceChildren();
    if (["queued", "running"].includes(job.state)) {
      const cancel = element.ownerDocument.createElement("button"); cancel.dataset.cancelJob = job.id; cancel.textContent = "Cancel"; actions.append(cancel);
    }
    if (job.state === "completed") {
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
