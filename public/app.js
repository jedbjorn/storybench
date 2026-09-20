import { StoryEditor } from "/story-editor.js?v=round2-editor";
import { LibraryWorkspace, episodeNavigatorHTML, uploadLibraryFile } from "/library-workspace.js";
import { attachMediaToCard, categoryForCardMedia, setCardType } from "/card-workspace.js";
import { ChatWorkspace } from "/chat-workspace.js";
import { jobsForOutputView, refreshJobStatus, renderJobList } from "/job-status.js";

const $ = (s) => document.querySelector(s);
let state = { episodes: [], assets: [], jobs: [] },
  episode = null,
  fieldTimer,
  dirty = false,
  saveInFlight = null,
  saveRequested = false,
  jobRefreshInFlight = null,
  boardSections = [],
  boardItems = [],
  cardImports = new Set();
const api = async (url, opt = {}) => {
  const r = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...opt,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(data.error || `Request failed (${r.status})`);
    Object.assign(error, data, { status: r.status });
    throw error;
  }
  return data;
};
const toast = (text) => {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function load(select) {
  const incoming = await api("/api/state");
  if (dirty || saveInFlight) {
    state = { ...incoming, episodes: state.episodes };
    return;
  }
  state = incoming;
  if (select) episode = state.episodes.find((e) => e.id === select) || null;
  else if (episode)
    episode = state.episodes.find((e) => e.id === episode.id) || null;
  render();
  await syncChat();
  if (episode && !$("#boardPanel").hidden) await loadBoardContext();
}
function render() {
  const filter = $("#episodeFilter").value;
  $("#episodes").innerHTML = episodeNavigatorHTML(state.episodes, filter, episode?.id);
  const selectedHidden = episode && filter !== "All" && episode.state !== filter;
  $("#filteredEpisodeNotice").hidden = !selectedHidden;
  $("#filteredEpisodeNotice").innerHTML = selectedHidden ? `Current episode is in ${esc(episode.state)}. <button data-reveal-episode>Show it</button>` : "";
  $("#empty").hidden = !!episode;
  $("#editor").hidden = !episode;
  if (!episode) return;
  $("#episodeTitle").value = episode.title;
  $("#episodeNotes").value = episode.notes;
  renderCards();
  renderJobs();
  if (!$("#storyPanel").hidden)
    storyEditor.open(episode.id).catch((error) => toast(error.message));
}
function renderJobs() {
  if (!episode) return;
  const episodeJobs = state.jobs.filter((job) => job.episodeId === episode.id);
  const drafts = jobsForOutputView(episodeJobs, "draft");
  const finals = jobsForOutputView(episodeJobs, "final");
  const activeCount = (jobs) => jobs.filter((job) => ["queued", "running"].includes(job.state)).length || "";
  $("#draftJobCount").textContent = activeCount(drafts);
  $("#finalJobCount").textContent = activeCount(finals);
  renderJobList($("#draftJobs"), drafts);
  renderJobList($("#finalJobs"), finals);
}

async function refreshJobs(target = episode?.id) {
  if (!jobRefreshInFlight) {
    jobRefreshInFlight = refreshJobStatus(api, () => state)
      .then((next) => { state = next; })
      .finally(() => { jobRefreshInFlight = null; });
  }
  await jobRefreshInFlight;
  if (episode?.id === target) renderJobs();
}

const storyEditor = new StoryEditor({
  root: $("#storyPanel"),
  api,
  setStatus: (text) => { $("#saveState").textContent = text; },
  toast,
  onSaved: () => refreshJobs().catch((error) => toast(error.message)),
});
const libraryWorkspace = new LibraryWorkspace({ api, toast, getEpisode: () => episode, refreshState: () => load(episode?.id), onMutation: () => refreshJobs().catch((error) => toast(error.message)) });
const chatWorkspace = new ChatWorkspace({ root: $("#chatWorkspace"), api, toast, getEpisode: () => episode });
async function syncChat() {
  if (episode?.id === chatWorkspace.episodeId) return;
  if (episode) await chatWorkspace.open();
  else chatWorkspace.close();
}

async function leaveStory() {
  const choice = await storyEditor.requestLeave();
  return choice !== "stay";
}
const cardTypes = ["Video/Audio", "Video", "Audio", "Static Graphic", "Video Graphic"];
function renderCards() {
  if (!episode) return;
  const groups = [...boardSections.map((section) => ({ id: section.id, title: section.title })), { id: "", title: "Unassigned planning" }];
  $("#cards").innerHTML = groups.map((group) => {
    const cards = episode.cards.map((card, index) => ({ card, index })).filter(({ card }) => (card.sectionId || "") === group.id).sort((a, b) => (a.card.order || 0) - (b.card.order || 0));
    return `<section class="card-group" data-card-section="${group.id}"><div class="card-group-heading"><h3>${esc(group.title)}</h3><span>${cards.length}</span></div>${cards.map(({ card, index }) => cardHTML(card, index)).join("") || '<p class="library-empty">Drop a card here.</p>'}</section>`;
  }).join("");
}
function itemOptions(card) {
  return `<option value="">Missing / choose media</option>${boardItems.map((item) => `<option value="${item.id}" ${item.id === card.itemId ? "selected" : ""}>${esc(item.label)} · ${esc(item.asset.kind)}</option>`).join("")}`;
}
function setCardMediaStatus(cardId, text, failed = false) {
  const card = [...document.querySelectorAll("[data-card-id]")].find((element) => element.dataset.cardId === cardId);
  const status = card?.querySelector("[data-card-media-status]");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("error", failed);
}
async function importMediaForCard(cardId, file) {
  if (!file || !episode) return;
  if (cardImports.has(cardId)) return toast("Wait for this card's current import to finish.");
  cardImports.add(cardId);
  const episodeId = episode.id;
  try {
    await flushDraft();
    const card = episode?.id === episodeId ? episode.cards.find((value) => value.id === cardId) : null;
    if (!card) throw new Error("The card is no longer available.");
    setCardMediaStatus(cardId, `Importing ${file.name}…`);
    const item = await uploadLibraryFile({ episodeId, file, category: categoryForCardMedia(card, file) });
    if (episode?.id !== episodeId) return toast(`${file.name} was imported to the previous episode's library.`);
    const currentCard = attachMediaToCard(episode.cards, cardId, item.id);
    if (!currentCard) return toast(`${file.name} was imported to the library, but the card was removed.`);
    boardItems = [...boardItems.filter((value) => value.id !== item.id), item];
    dirty = true;
    await save();
    if (dirty && $("#saveState").textContent.includes("reload"))
      throw new Error(`${file.name} was imported, but the card link was not saved. Reload and choose it from Registered media.`);
    toast(`${file.name} imported and added to the card`);
  } catch (error) {
    setCardMediaStatus(cardId, error.message, true);
    toast(error.message);
  } finally {
    cardImports.delete(cardId);
  }
}
function sectionOptions(card) { return `<option value="">Unassigned</option>${boardSections.map((section) => `<option value="${section.id}" ${section.id === card.sectionId ? "selected" : ""}>${esc(section.title)}</option>`).join("")}`; }
function preview(card) {
  const item = boardItems.find((value) => value.id === card.itemId);
  if (!item) return '<div class="card-preview missing">Missing media</div>';
  const source = `/api/episodes/${episode.id}/library/${item.id}/file`;
  if (item.asset.kind === "image") return `<img class="card-preview" src="${source}" alt="">`;
  if (item.asset.kind === "video") return `<video class="card-preview" src="${source}" controls preload="metadata"></video>`;
  if (item.asset.kind === "audio") return `<audio class="card-preview" src="${source}" controls preload="metadata"></audio>`;
  return '<div class="card-preview missing">No media preview</div>';
}
function cardHTML(c, i) {
  const visualCards = episode.cards.filter((value) => value.id !== c.id && value.type !== "Audio");
  return `<article class="story-card typed-card" draggable="true" data-index="${i}" data-card-id="${c.id}"><div class="drag">⋮⋮</div><div class="card-main"><div class="card-primary"><select data-key="type">${cardTypes.map((type) => `<option ${type === c.type ? "selected" : ""}>${type}</option>`).join("")}</select><input class="card-title" data-key="title" value="${esc(c.title)}" placeholder="Card title"><select data-key="sectionId">${sectionOptions(c)}</select></div><textarea data-key="prompt" placeholder="What should this card accomplish?">${esc(c.prompt)}</textarea>${preview(c)}<div class="card-media-controls"><label>Registered media<select data-key="itemId">${itemOptions(c)}</select></label><div class="card-media-dropzone" data-card-media-drop tabindex="0">Drop media here or <button type="button" data-card-media-pick>choose a file</button><input data-card-media-file type="file" hidden></div></div><div class="card-media-status" data-card-media-status aria-live="polite"></div><details><summary>Timing, references and notes</summary><div class="timing"><label><span>In</span><input data-key="in" type="number" min="0" step=".033" value="${c.in ?? ""}"></label><label><span>Out</span><input data-key="out" type="number" min="0" step=".033" value="${c.out ?? ""}"></label><label><span>Duration</span><input data-key="duration" type="number" min=".033" step=".033" value="${c.duration ?? ""}"></label><label><span>Gain</span><input data-key="gain" type="number" min="0" max="8" step=".1" value="${c.gain ?? 1}"></label></div>${c.type === "Audio" ? `<div class="timing"><label>Role<select data-key="role">${["voiceover", "music", "sound effect", "other"].map((role) => `<option ${role === c.role ? "selected" : ""}>${role}</option>`).join("")}</select></label><label>Anchor<select data-key="anchorVisualCardId"><option value="">Choose visual</option>${visualCards.map((card) => `<option value="${card.id}" ${card.id === c.anchorVisualCardId ? "selected" : ""}>${esc(card.title)}</option>`).join("")}</select></label><label>Offset<input data-key="offset" type="number" min="0" step=".033" value="${c.offset ?? 0}"></label></div>` : ""}<label>Reference items<select data-key="referenceItemIds" multiple>${boardItems.filter((item) => item.category === "Reference").map((item) => `<option value="${item.id}" ${(c.referenceItemIds || []).includes(item.id) ? "selected" : ""}>${esc(item.label)}</option>`).join("")}</select></label><label>Reference URLs<textarea data-key="referenceUrls" placeholder="One URL per line">${esc((c.referenceUrls || []).join("\n"))}</textarea></label><label>Notes<textarea data-key="notes">${esc(c.notes)}</textarea></label><label><input data-key="excluded" type="checkbox" ${c.excluded ? "checked" : ""}> Exclude from assembled cut</label></details></div><div class="card-tools"><button data-promote title="Promote to channel">☆</button><button data-move="-1" title="Move up">↑</button><button data-move="1" title="Move down">↓</button><button data-delete title="Delete">×</button></div></article>`;
}
async function loadBoardContext() {
  if (!episode) return;
  const id = episode.id;
  const [story, items] = await Promise.all([api(`/api/episodes/${id}/story`), api(`/api/episodes/${id}/library`)]);
  if (episode?.id !== id) return;
  boardSections = story.sections || []; boardItems = items; renderCards();
}
let promotingCard = null;
function openPromote(card) {
  promotingCard = card;
  const form = $("#promoteCardForm");
  form.elements.name.value = card.title || "Reusable card";
  form.elements.role.value = "";
  form.querySelector("[data-promote-error]").textContent = "";
  $("#promoteCardModal").showModal();
}
$("#promoteCardForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await flushDraft();
    await api(`/api/episodes/${episode.id}/cards/${promotingCard.id}/promote`, { method: "POST", body: JSON.stringify({ name: form.elements.name.value, role: form.elements.role.value || null }) });
    $("#promoteCardModal").close(); toast("Card promoted to channel branding");
  } catch (error) { form.querySelector("[data-promote-error]").textContent = error.message; }
};
document.querySelectorAll("[data-promote-close]").forEach((button) => button.onclick = () => $("#promoteCardModal").close());
document.querySelectorAll("[data-graphic-close]").forEach((button) => button.onclick = () => $("#graphicModal").close());
document.querySelectorAll("[data-branding-close]").forEach((button) => button.onclick = () => $("#brandingModal").close());
$("#openBranding").onclick = async () => {
  try {
    const templates = await api("/api/branding");
    $("#brandingTemplates").innerHTML = templates.map((template) => `<article class="branding-template"><div><b>${esc(template.name)}</b><span>${template.role ? `Standard ${esc(template.role)}` : "Reusable"} · ${esc(template.card.type)}</span></div><div><select data-branding-role="${template.id}"><option value="" ${!template.role ? "selected" : ""}>Reusable</option><option value="intro" ${template.role === "intro" ? "selected" : ""}>Intro</option><option value="outro" ${template.role === "outro" ? "selected" : ""}>Outro</option></select><button data-branding-apply="${template.id}" ${episode ? "" : "disabled"}>Add to episode</button></div></article>`).join("") || "<p>No reusable cards yet. Promote one from the Storyboard.</p>";
    $("#brandingModal").showModal();
  } catch (error) { toast(error.message); }
};
$("#brandingTemplates").onchange = async (event) => {
  const id = event.target.dataset.brandingRole;
  if (!id) return;
  try { await api(`/api/branding/${id}`, { method: "PUT", body: JSON.stringify({ role: event.target.value || null }) }); toast("Standard role updated"); }
  catch (error) { toast(error.message); }
};
$("#brandingTemplates").onclick = async (event) => {
  const id = event.target.closest("[data-branding-apply]")?.dataset.brandingApply;
  if (!id || !episode) return;
  try { await flushDraft(); episode = await api(`/api/episodes/${episode.id}/branding/${id}/apply`, { method: "POST", body: "{}" }); await load(episode.id); await loadBoardContext(); toast("Reusable card added"); }
  catch (error) { toast(error.message); }
};
async function save(changes = {}) {
  if (!episode) return;
  clearTimeout(fieldTimer);
  dirty = true;
  if (saveInFlight) {
    saveRequested = true;
    return saveInFlight;
  }
  const target = episode.id,
    revision = episode.revision,
    cards = structuredClone(episode.cards),
    title = $("#episodeTitle").value,
    notes = $("#episodeNotes").value;
  dirty = false;
  saveRequested = false;
  $("#saveState").textContent = "Saving…";
  saveInFlight = (async () => {
    try {
      const updated = await api(`/api/episodes/${target}`, {
        method: "PUT",
        body: JSON.stringify({
          expectedRevision: revision,
          title,
          notes,
          cards,
          ...changes,
        }),
      });
      if (episode?.id === target) {
        const localCards = episode.cards,
          localTitle = $("#episodeTitle").value,
          localNotes = $("#episodeNotes").value;
        episode =
          dirty || saveRequested
            ? {
                ...updated,
                title: localTitle,
                notes: localNotes,
                cards: localCards,
              }
            : updated;
        $("#saveState").textContent =
          dirty || saveRequested
            ? "Unsaved changes"
            : `Saved · r${updated.revision}`;
        if (!dirty && !saveRequested) render();
      }
      return updated;
    } catch (e) {
      if (episode?.id === target) {
        dirty = true;
        $("#saveState").textContent = "Not saved — reload to resolve";
        toast(e.message);
      }
      throw e;
    } finally {
      saveInFlight = null;
    }
  })();
  let saved = true;
  try {
    await saveInFlight;
  } catch {
    saved = false;
  }
  if (saved) await refreshJobs(target).catch((error) => toast(error.message));
  if (saved && (dirty || saveRequested) && episode?.id === target)
    return save();
}
async function flushDraft() {
  clearTimeout(fieldTimer);
  while (dirty || saveInFlight || saveRequested) {
    if (dirty || saveRequested) await save();
    else await saveInFlight?.catch(() => {});
    if (
      dirty &&
      !saveInFlight &&
      $("#saveState").textContent.includes("reload")
    )
      throw new Error("Resolve the unsaved conflict before continuing");
  }
}
async function create() {
  if (!(await leaveStory())) return;
  await flushDraft();
  const e = await api("/api/episodes", {
    method: "POST",
    body: JSON.stringify({ title: "Untitled episode" }),
  });
  await load(e.id);
}
$("#episodes").onclick = async (e) => {
  if (!e.target.closest("[data-episode-select]")) return;
  const id = e.target.closest("[data-id]")?.dataset.id;
  if (id && id !== episode?.id && (await leaveStory())) {
    await flushDraft();
    episode = state.episodes.find((x) => x.id === id);
    render();
    await chatWorkspace.open();
    if (!$("#mediaPanel").hidden) libraryWorkspace.open().catch((error) => toast(error.message));
  }
};
$("#episodes").onchange = async (event) => {
  if (!event.target.matches("[data-episode-state-select]")) return;
  const row = event.target.closest("[data-id]");
  await moveEpisodeState(row.dataset.id, event.target.value);
};
$("#episodes").ondragstart = (event) => {
  const row = event.target.closest("[data-id]");
  if (row) event.dataTransfer.setData("text/episode-id", row.dataset.id);
};
$("#episodes").ondragover = (event) => { if (event.target.closest("[data-episode-state]")) event.preventDefault(); };
$("#episodes").ondrop = async (event) => {
  const group = event.target.closest("[data-episode-state]");
  const id = event.dataTransfer.getData("text/episode-id");
  if (group && id) { event.preventDefault(); await moveEpisodeState(id, group.dataset.episodeState); }
};
async function moveEpisodeState(id, nextState) {
  const target = state.episodes.find((candidate) => candidate.id === id);
  if (!target || target.state === nextState) return;
  try {
    if (id === episode?.id) await flushDraft();
    const updated = await api(`/api/episodes/${id}`, { method: "PUT", body: JSON.stringify({ expectedRevision: target.revision, state: nextState }) });
    state.episodes = state.episodes.map((candidate) => candidate.id === id ? updated : candidate);
    if (episode?.id === id) episode = updated;
    render();
  } catch (error) { toast(error.message); await load(episode?.id); }
}
$("#episodeFilter").onchange = render;
$("#filteredEpisodeNotice").onclick = (event) => { if (event.target.closest("[data-reveal-episode]")) { $("#episodeFilter").value = "All"; render(); } };
$("#newEpisode").onclick = $("#firstEpisode").onclick = create;
$("#episodeTitle").oninput = $("#episodeNotes").oninput = () => {
  dirty = true;
  $("#saveState").textContent = "Unsaved changes";
  clearTimeout(fieldTimer);
  fieldTimer = setTimeout(() => save(), 500);
};
$("#addCard").onclick = () => {
  episode.cards.push({
    id: crypto.randomUUID(),
    title: "New scene",
    type: "Video",
    prompt: "",
    purpose: "",
    notes: "",
    missing: "",
    visual: null,
    narration: null,
    duration: null,
    sectionId: boardSections[0]?.id || null,
    itemId: null,
    referenceItemIds: [],
    order: episode.cards.length,
    enabled: true,
  });
  dirty = true;
  save();
};
$("#cards").onchange = (e) => {
  const el = e.target,
    wrap = el.closest(".story-card");
  if (!wrap) return;
  if (el.matches("[data-card-media-file]")) {
    const file = el.files[0];
    el.value = "";
    return importMediaForCard(wrap.dataset.cardId, file);
  }
  if (!el.dataset.key) return;
  const card = episode.cards[Number(wrap.dataset.index)];
  const key = el.dataset.key;
  if (key === "type") setCardType(card, el.value);
  else if (key === "referenceItemIds") card[key] = [...el.selectedOptions].map((option) => option.value);
  else if (key === "referenceUrls") card[key] = el.value.split("\n").map((value) => value.trim()).filter(Boolean);
  else if (key === "excluded") card[key] = el.checked;
  else if (["duration", "in", "out", "offset", "gain", "fadeIn", "fadeOut"].includes(key)) card[key] = el.value === "" ? null : Number(el.value);
  else card[key] = el.value || (["sectionId", "itemId", "anchorVisualCardId"].includes(key) ? null : "");
  dirty = true;
  save();
};
$("#cards").onclick = (e) => {
  const wrap = e.target.closest(".story-card");
  if (!wrap) return;
  const i = Number(wrap.dataset.index);
  if (e.target.closest("[data-card-media-pick]")) return wrap.querySelector("[data-card-media-file]").click();
  if (e.target.closest("[data-promote]")) return openPromote(episode.cards[i]);
  if (e.target.closest("[data-delete]")) episode.cards.splice(i, 1);
  else if (e.target.closest("[data-move]")) {
    const peers = episode.cards.map((card, index) => ({ card, index })).filter(({ card }) => card.sectionId === episode.cards[i].sectionId).sort((a, b) => (a.card.order || 0) - (b.card.order || 0));
    const position = peers.findIndex((value) => value.index === i), next = position + Number(e.target.closest("[data-move]").dataset.move);
    if (next < 0 || next >= peers.length) return;
    [peers[position].card.order, peers[next].card.order] = [peers[next].card.order || next, peers[position].card.order || position];
  } else return;
  dirty = true;
  save();
};
$("#cards").onkeydown = (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const mediaDrop = event.target.closest("[data-card-media-drop]");
  if (!mediaDrop || event.target.closest("button")) return;
  event.preventDefault();
  mediaDrop.querySelector("[data-card-media-file]").click();
};
$("#cards").ondragstart = (event) => { const card = event.target.closest("[data-card-id]"); if (card) event.dataTransfer.setData("text/card-id", card.dataset.cardId); };
$("#cards").ondragover = (event) => {
  const mediaDrop = event.target.closest("[data-card-media-drop]");
  if (mediaDrop && [...event.dataTransfer.types].includes("Files")) {
    event.preventDefault();
    mediaDrop.classList.add("drag-over");
  } else if (event.target.closest("[data-card-section]")) event.preventDefault();
};
$("#cards").ondragleave = (event) => event.target.closest("[data-card-media-drop]")?.classList.remove("drag-over");
$("#cards").ondrop = (event) => {
  const mediaDrop = event.target.closest("[data-card-media-drop]");
  if (mediaDrop && event.dataTransfer.files.length) {
    event.preventDefault();
    mediaDrop.classList.remove("drag-over");
    if (event.dataTransfer.files.length > 1) return toast("Drop one file per card.");
    return importMediaForCard(mediaDrop.closest("[data-card-id]").dataset.cardId, event.dataTransfer.files[0]);
  }
  const group = event.target.closest("[data-card-section]"), id = event.dataTransfer.getData("text/card-id");
  if (!group || !id) return;
  event.preventDefault();
  const card = episode.cards.find((value) => value.id === id);
  if (card) { card.sectionId = group.dataset.cardSection || null; card.order = episode.cards.filter((value) => value.sectionId === card.sectionId).length; dirty = true; save(); }
};
$("#undo").onclick = async () => {
  try {
    await flushDraft();
    episode = await api(`/api/episodes/${episode.id}/undo`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision: episode.revision }),
    });
    await load(episode.id);
  } catch (e) {
    toast(e.message);
  }
};
async function showTab(tab, { confirmStory = true } = {}) {
      const b = document.querySelector(`.tabs > button[data-tab="${tab}"]`);
      if (!b) return;
      if (confirmStory && b.dataset.tab !== "story" && !(await leaveStory())) return;
      document
        .querySelectorAll(".tabs > button")
        .forEach((x) => x.classList.toggle("active", x === b));
      ["story", "board", "media", "drafts", "final"].forEach(
        (x) => ($(`#${x}Panel`).hidden = b.dataset.tab !== x),
      );
      if (b.dataset.tab === "story" && episode)
        storyEditor.open(episode.id).catch((error) => toast(error.message));
      if (b.dataset.tab === "media" && episode)
        libraryWorkspace.open().catch((error) => toast(error.message));
      if (b.dataset.tab === "board" && episode)
        loadBoardContext().catch((error) => toast(error.message));
}
document.querySelectorAll(".tabs > button").forEach((button) => {
  button.onclick = () => showTab(button.dataset.tab);
});
async function renderJob(kind) {
  try {
    await flushDraft();
    const plan = await api(`/api/episodes/${episode.id}/render-plan`);
    let finalGrantId = null, requestId = null, conversationId = null;
    if (kind === "final") {
      conversationId = chatWorkspace.currentId;
      if (!conversationId) requestId = crypto.randomUUID();
      const grant = await api(`/api/episodes/${episode.id}/final-authorizations`, { method: "POST",
        body: JSON.stringify({ expectedRenderRevision: plan.renderRevision, conversationId, requestId }) });
      finalGrantId = grant.id;
    }
    await api(`/api/episodes/${episode.id}/render`, {
      method: "POST",
      body: JSON.stringify({ outputClass: kind, expectedRenderRevision: plan.renderRevision, finalGrantId, conversationId, requestId }),
    });
    toast(`${kind === "final" ? "Final" : "Draft"} queued`);
    await load(episode.id);
    await showTab(kind === "final" ? "final" : "drafts", { confirmStory: false });
  } catch (e) {
    toast(e.message);
  }
}
$("#preview").onclick = () => renderJob("draft");
$("#export").onclick = () => renderJob("final");
document.querySelectorAll("[data-jobs-list]").forEach((list) => list.onclick = async (event) => {
  const id = event.target.closest("[data-cancel-job]")?.dataset.cancelJob;
  if (!id || !episode) return;
  try { await api(`/api/episodes/${episode.id}/jobs/${id}/cancel`, { method: "POST", body: "{}" }); await load(episode.id); }
  catch (error) { toast(error.message); }
});
$("#openGraphic").onclick = () => {
  if (!episode) return;
  const form = $("#graphicForm");
  form.elements.cardId.innerHTML = `<option value="">Library only</option>${episode.cards.map((card) => `<option value="${card.id}">${esc(card.title || card.type)}</option>`).join("")}`;
  form.querySelector("[data-graphic-error]").textContent = "";
  $("#graphicModal").showModal();
};
$("#graphicForm").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget, kind = form.elements.kind.value;
  const duration = Number(form.elements.duration.value);
  const layer = { kind: "text", text: form.elements.text.value, x: 640, y: 360, fontSize: 64,
    fill: form.elements.fill.value, textAnchor: "middle", opacity: 1, z: 0,
    ...(kind === "motion" ? { keyframes: { opacity: [{ time: 0, value: 0, easing: "linear" }, { time: duration, value: 1, easing: "linear" }] } } : {}) };
  const recipe = { kind, width: 1280, height: 720, background: form.elements.background.value, layers: [layer],
    ...(kind === "motion" ? { duration, fps: 30 } : {}) };
  try {
    await flushDraft();
    const graphic = await api(`/api/episodes/${episode.id}/graphics`, { method: "POST", body: JSON.stringify({
      name: form.elements.name.value, cardId: form.elements.cardId.value || null, recipe }) });
    await api(`/api/episodes/${episode.id}/graphics/${graphic.id}/render`, { method: "POST",
      body: JSON.stringify({ expectedRecipeRevision: graphic.revision }) });
    $("#graphicModal").close(); toast("Graphic queued"); await load(episode.id);
    await showTab("drafts", { confirmStory: false });
  } catch (error) { form.querySelector("[data-graphic-error]").textContent = error.message; }
};
setInterval(async () => {
  if (!episode) return;
  try {
    if (
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) &&
      state.jobs.some((j) => ["queued", "running"].includes(j.state))
    ) {
      await load(episode.id);
    } else await refreshJobs(episode.id);
  } catch (error) { toast(error.message); }
}, 1800);
window.addEventListener("beforeunload", (event) => {
  if (storyEditor.isDirty()) event.preventDefault();
});
load().catch((e) => toast(e.message));
