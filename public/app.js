import { previewUrl, withChannel } from "/preview-links.js";
import { newSlide, slideListHTML, bindSlideList } from "/deck-workspace.js";
import { createDeckCanvas, createSlidePreview, slideFrameUrl } from "/deck-canvas.js";
import { createSlideEditor } from "/slide-editor.js";
import { installSelectControls } from "/select-control.js";
import { installWorkspaceChrome } from "/workspace-chrome.js";
import { installProductionSearch } from "/production-search.js";
import { installChannelDrawer } from "/channel-drawer.js";
import { SettingsPages } from "/settings-pages.js";
import { StoryEditor, createStoryRenderer, createChatRenderer } from "/story-editor.js?v=round2-editor";
import { ResearchEditor } from "/research-workspace.js";
import { LibraryWorkspace, episodeNavigatorHTML, uploadLibraryFile } from "/library-workspace.js";
import { attachMediaToCard, categoryForCardMedia, setCardType } from "/card-workspace.js";
import { linkReference, referencePanelHTML, unlinkReference } from "/reference-workspace.js";
import { ChatWorkspace } from "/chat-workspace.js";
import { formatBytes, jobsForOutputView, refreshJobStatus, releasePlayer, renderJobList } from "/job-status.js";
import { cleanupRowsHTML, selectedTotal, toggleSelection } from "/draft-cleanup.js";
import { PreviewModal } from "/preview-modal.js";
import { icons } from "/icons.js";

installSelectControls();

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
  boardItemsEpisode = null,
  cardImports = new Set(),
  collapsedCardIds = new Set(),
  cardCollapseEpisode = null,
  loadGeneration = 0;
// The channel this view is showing. It is captured once (from ?channel= or the default at first load) and sent
// with every request, so changing the installation default elsewhere never retargets this open view.
let channelId = new URLSearchParams(location.search).get("channel") || null;
const api = async (url, { headers = {}, ...opt } = {}) => {
  const r = await fetch(url, {
    headers: { "content-type": "application/json", ...(channelId ? { "x-storybench-channel": channelId } : {}), ...headers },
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
const stateUrl = () => channelId ? `/api/state?channel=${encodeURIComponent(channelId)}` : "/api/state";
function showChannel(channel) {
  if (channel && !channelId) {
    channelId = channel.id;
    const next = new URL(location.href);
    next.searchParams.set("channel", channel.id);
    history.replaceState(history.state, "", next);
  }
  $("#channelName").textContent = channel ? channel.name : "No channel";
  $("#channelName").title = channel ? `Channel ${channel.name} (${channel.id})` : "Create a channel to start";
}
async function load(select, { remember = true } = {}) {
  const generation = ++loadGeneration, requestedId = channelId;
  const incoming = await api(stateUrl());
  if (generation !== loadGeneration || requestedId !== channelId) return;
  showChannel(incoming.channel);
  if (dirty || saveInFlight) {
    state = { ...incoming, episodes: state.episodes };
    return;
  }
  state = incoming;
  if (select) episode = state.episodes.find((e) => e.id === select) || null;
  else if (episode)
    episode = state.episodes.find((e) => e.id === episode.id) || null;
  render();
  if (select && remember) rememberEpisode();
  await syncChat();
  if (episode && !$("#boardPanel").hidden) await loadBoardContext();
}
// One episode event stream per open production, used only for library removals (redline images on a new chat).
let libraryEvents = null, libraryEventsEpisode = null;
function watchLibraryRemovals() {
  const id = episode?.id ?? null;
  if (id === libraryEventsEpisode) return;
  libraryEvents?.close();
  libraryEvents = null; libraryEventsEpisode = id;
  if (!id) return;
  libraryEvents = new EventSource(withChannel(`/api/episodes/${encodeURIComponent(id)}/events`, channelId));
  libraryEvents.onmessage = (event) => {
    const detail = JSON.parse(event.data);
    if (!detail.libraryRemoved?.length || detail.episodeId !== episode?.id) return;
    libraryWorkspace.drop(detail.episodeId, detail.libraryRemoved);
    if (boardItemsEpisode === detail.episodeId && boardItems) boardItems = boardItems.filter((item) => !detail.libraryRemoved.includes(item.id));
  };
}
function render() {
  watchLibraryRemovals();
  $('#newEpisode').disabled = !channelId;
  $('#firstEpisode').textContent = channelId ? 'Create a production' : 'Create a channel';
  const filter = $("#episodeFilter").value;
  $("#episodes").innerHTML = episodeNavigatorHTML(state.episodes, filter, episode?.id);
  const episodeGroup = episode?.archivedAt ? "Archived" : episode?.state;
  const selectedHidden = episode && (filter === "All" ? episodeGroup === "Archived" : episodeGroup !== filter);
  $("#filteredEpisodeNotice").hidden = !selectedHidden;
  $("#filteredEpisodeNotice").innerHTML = selectedHidden ? `Current production is in ${esc(episodeGroup)}. <button data-reveal-episode>Show it</button>` : "";
  $("#empty").hidden = !!episode;
  $("#editor").hidden = !episode;
  if (!episode) { researchEditor.close(); $('#episodeTitle').value = ''; $('#episodeNotes').value = ''; return; }
  const deck = episode.kind === "deck";
  for (const selector of ['#preview', '#export', '#openGraphic', '[data-tab="drafts"]', '[data-tab="final"]']) {
    const control = $(selector); if (control) control.hidden = deck;
  }
  $("#deckOutputs").hidden = !deck;
  $("#productionReferencesLabel").textContent = deck ? "Deck references" : "Episode references";
  $("#addCard").hidden = deck;
  if (deck && (!$("#draftsPanel").hidden || !$("#finalPanel").hidden)) {
    for (const name of ['story','board','media','research','drafts','final']) $(`#${name}Panel`).hidden = name !== 'board';
    document.querySelectorAll('.tabs > button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'board'));
  }
  $("#boardPanel h2").textContent = deck ? "Slides" : "Story cards";
  $("#boardPanel .panel-heading p").textContent = deck ? "Compose slides, notes and reveals. Build a portable deck, open it in Preview and download the ZIP." : "Each card becomes one scene in the finished video.";
  $('[data-tab="board"]').textContent = deck ? "Slides" : "Storyboard";
  $("#episodeTitle").setAttribute('aria-label', deck ? 'Deck title' : 'Episode title');
  $("#mediaPanel h2").textContent = deck ? 'Deck library' : 'Episode library';
  $("#mediaPanel .panel-heading p").textContent = deck ? 'Import media here, then choose it in a slide.' : 'References and media stay grouped here until you explicitly add them to cards.';
  $("#episodeTitle").value = episode.title;
  $("#episodeNotes").value = episode.notes;
  renderEpisodeReferences();
  renderCards();
  renderJobs();
  if (!$("#storyPanel").hidden)
    storyEditor.open(episode.id).catch((error) => toast(error.message));
  if (!$("#researchPanel").hidden) researchEditor.open(episode.id);
}
// The job poll calls renderJobs every 1.8 s; rewrite the deck list only when it changed, so its links stay put.
let deckJobsHTML = null;
function deckJobHTML(job) {
  const meta = job.state === 'completed' ? new Date(job.finishedAt || job.createdAt).toLocaleString()
    : ['queued', 'running'].includes(job.state) ? `${esc(job.state)} · ${Math.round(job.progress * 100)}%` : esc(job.state);
  const actions = job.state === 'completed'
    ? `<a class="icon-button" href="${esc(previewUrl('deck', job.id, channelId))}" target="storybench-preview" aria-label="Preview revision ${esc(job.revision)}" title="Preview">${icons.preview}</a><a class="icon-button" href="${esc(withChannel(`/api/jobs/${encodeURIComponent(job.id)}/deck/bundle.zip`, channelId))}" download aria-label="Download revision ${esc(job.revision)} bundle (ZIP)" title="Download bundle (ZIP)">${icons.download}</a>`
    : ['queued', 'running'].includes(job.state) ? `<button data-deck-cancel="${esc(job.id)}">Cancel build</button>` : '';
  return `<article class="deck-build" data-deck-job="${esc(job.id)}"><div><strong>Revision ${esc(job.revision)}</strong><span>${meta}</span></div><div class="deck-build-actions">${actions}</div>${job.error ? `<p role="alert">${esc(job.error)}</p>` : ''}</article>`;
}
// Building is offered only when the saved revision has no completed or active build (or edits are still saving).
function syncBuildDeckButton(jobs) {
  const current = jobs.filter(job => job.revision === episode.revision);
  const building = current.some(job => ['queued', 'running'].includes(job.state));
  const built = current.some(job => job.state === 'completed');
  const unsaved = dirty || saveRequested || !!saveInFlight;
  const fresh = !!episode.cards.length && (unsaved || !(building || built));
  const button = $('#buildDeck');
  button.disabled = !fresh;
  button.textContent = fresh || !episode.cards.length ? 'Build saved deck' : building ? 'Building…' : 'Deck up to date';
}
function renderJobs() {
  if (!episode) return;
  if (episode.kind === "deck") {
    // Active builds and the newest finished one stay in view; older builds fold away.
    const jobs = state.jobs.filter(job => job.episodeId === episode.id && job.kind === 'deck');
    syncBuildDeckButton(jobs);
    const latest = jobs.find(job => !['queued', 'running'].includes(job.state));
    const shown = jobs.filter(job => job === latest || ['queued', 'running'].includes(job.state)), earlier = jobs.filter(job => !shown.includes(job));
    const html = shown.map(deckJobHTML).join('') + (earlier.length ? `<details class="deck-history"><summary>Earlier builds (${earlier.length})</summary>${earlier.map(deckJobHTML).join('')}</details>` : '');
    if (html !== deckJobsHTML) {
      const open = $('#deckJobs .deck-history')?.open;
      $('#deckJobs').innerHTML = deckJobsHTML = html;
      if (open && $('#deckJobs .deck-history')) $('#deckJobs .deck-history').open = true;
    }
    $("#draftJobs").innerHTML = ""; $("#finalJobs").innerHTML = ""; return;
  }
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
    jobRefreshInFlight = refreshJobStatus(api, () => state, stateUrl())
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
const researchEditor = new ResearchEditor({ root: $("#researchPanel"), api, renderMarkdown: createStoryRenderer() });
const previewModal = new PreviewModal($("#previewModal"));
// Every Preview link opens the popup; a modified click still opens a browser tab.
document.addEventListener("click", (event) => {
  const link = event.target.closest?.('a[target="storybench-preview"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  previewModal.open({ url: link.getAttribute("href") });
});
const libraryWorkspace = new LibraryWorkspace({ api, toast, preview: previewModal, getEpisode: () => episode, refreshState: () => load(episode?.id), beforeDelete: flushDraft, onMutation: () => refreshJobs().catch((error) => toast(error.message)), onAskForAnother: fillChatDraft });
// Ask for another (deck asset preview): the request waits in the chat composer for the creator's direction.
function fillChatDraft(text) {
  const field = chatWorkspace.draftField();
  if (!field) return;
  field.value = text; field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus(); field.setSelectionRange(text.length, text.length);
}
const chatWorkspace = new ChatWorkspace({ root: $("#chatWorkspace"), api, renderMarkdown: createChatRenderer(), toast, getEpisode: () => episode, onBusyChange: setProductionBusy, beforeSend: async () => { if (!(await leaveStory())) throw new Error("Save or discard story edits before sending"); await flushDraft(); } });
async function syncChat() {
  if (episode?.id === chatWorkspace.episodeId) return;
  if (episode) await chatWorkspace.open();
  else chatWorkspace.close();
}

async function leaveStory() {
  const choice = await storyEditor.requestLeave();
  return choice !== "stay";
}
async function leaveResearch() {
  return (await researchEditor.requestLeave()) !== "stay";
}
function setProductionBusy(busy) {
  const explanation = busy ? "A request is already active for this episode. Let it finish or press Stop." : "";
  for (const button of document.querySelectorAll("#openGraphic, #preview, #export, [data-card-build]")) {
    button.disabled = busy;
    button.title = explanation || button.getAttribute("aria-label") || "";
  }
}
async function askAssistant(kind, { targetCardId = null, prompt = "" } = {}) {
  if (!episode) return false;
  if (!(await leaveStory())) return false;
  await flushDraft();
  await chatWorkspace.sendProduction({ kind, targetCardId, prompt });
  toast("Request sent to the episode assistant");
  return true;
}
const cardTypes = ["Video/Audio", "Video", "Audio", "Static Graphic", "Video Graphic"];
function renderCards() {
  if (!episode) return;
  const deck = episode.kind === "deck";
  $("#deckSlides").hidden = !deck; $("#cards").hidden = deck;
  if (deck) { if (slideEditor.isOpen) slideEditor.render(); else renderSlideList(); return; }
  if (cardCollapseEpisode !== episode.id) {
    collapsedCardIds.clear();
    cardCollapseEpisode = episode.id;
  }
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
  const collapsed = collapsedCardIds.has(c.id);
  return `<article class="story-card typed-card" data-index="${i}" data-card-id="${c.id}"><div class="card-move-tools"><div class="drag" draggable="true" title="Drag to move card">⋮⋮</div><button type="button" data-move="-1" aria-label="Move ${esc(c.title || "card")} up" title="Move up">↑</button><button type="button" data-move="1" aria-label="Move ${esc(c.title || "card")} down" title="Move down">↓</button></div><div class="card-body"><button type="button" class="card-collapse" data-card-collapse aria-expanded="${!collapsed}" aria-controls="card-content-${esc(c.id)}"><span aria-hidden="true">${collapsed ? "▸" : "▾"}</span><strong>${esc(c.title || "Untitled card")}</strong></button><div class="card-expanded" id="card-content-${esc(c.id)}" ${collapsed ? "hidden" : ""}><div class="card-expanded-actions"><button type="button" data-promote aria-label="Promote ${esc(c.title || "card")} to channel" title="Promote to channel">☆ Promote</button><button type="button" data-delete aria-label="Delete ${esc(c.title || "card")}" title="Delete card" class="danger-text">Delete</button></div><div class="card-main"><div class="card-primary"><label>Card type<select data-key="type">${cardTypes.map((type) => `<option ${type === c.type ? "selected" : ""}>${type}</option>`).join("")}</select></label><label>Title<input class="card-title" data-key="title" value="${esc(c.title)}" placeholder="Card title"></label><label>Story section<select data-key="sectionId">${sectionOptions(c)}</select></label></div><label class="card-direction">Direction<textarea data-key="prompt" placeholder="What should this card accomplish?">${esc(c.prompt)}</textarea></label><div class="card-media-workspace">${preview(c)}${referencePanelHTML({ scope: "card", cardId: c.id, episodeId: episode.id, prompt: c.referencePrompt || "", itemIds: c.referenceItemIds || [], items: libraryForPanels() })}</div><button type="button" data-card-build aria-label="Ask the assistant to ${c.itemId ? "revise" : "build"} the output for ${esc(c.title || "this card")}">${c.itemId ? "Revise" : "Build"} with assistant</button><div class="card-media-controls"><label>Output media (footage)<select data-key="itemId">${itemOptions(c)}</select></label><div class="card-media-dropzone" data-card-media-drop tabindex="0">Drop footage/output media here or <button type="button" data-card-media-pick>choose a file</button><input data-card-media-file type="file" hidden></div></div><div class="card-media-status" data-card-media-status aria-live="polite"></div><details><summary>Timing and notes</summary><div class="timing"><label><span>In</span><input data-key="in" type="number" min="0" step=".033" value="${c.in ?? ""}"></label><label><span>Out</span><input data-key="out" type="number" min="0" step=".033" value="${c.out ?? ""}"></label><label><span>Duration</span><input data-key="duration" type="number" min=".033" step=".033" value="${c.duration ?? ""}"></label><label><span>Gain</span><input data-key="gain" type="number" min="0" max="8" step=".1" value="${c.gain ?? 1}"></label></div>${c.type === "Audio" ? `<div class="timing"><label>Role<select data-key="role">${["voiceover", "music", "sound effect", "other"].map((role) => `<option ${role === c.role ? "selected" : ""}>${role}</option>`).join("")}</select></label><label>Anchor<select data-key="anchorVisualCardId"><option value="">Choose visual</option>${visualCards.map((card) => `<option value="${card.id}" ${card.id === c.anchorVisualCardId ? "selected" : ""}>${esc(card.title)}</option>`).join("")}</select></label><label>Offset<input data-key="offset" type="number" min="0" step=".033" value="${c.offset ?? 0}"></label></div>` : ""}<label>Notes<textarea data-key="notes">${esc(c.notes)}</textarea></label><label class="checkbox-row"><input data-key="excluded" type="checkbox" ${c.excluded ? "checked" : ""}> Exclude from assembled cut</label></details></div></div></div></article>`;
}
async function loadBoardContext() {
  if (!episode) return;
  const id = episode.id;
  const [story, items] = await Promise.all([api(`/api/episodes/${id}/story`), api(`/api/episodes/${id}/library`)]);
  if (episode?.id !== id) return;
  boardSections = story.sections || []; boardItems = items; boardItemsEpisode = id; renderCards(); renderEpisodeReferences();
}
const libraryForPanels = () => (episode && boardItemsEpisode === episode.id ? boardItems : null);
function renderEpisodeReferences() {
  if (!episode) return;
  const ids = episode.referenceItemIds || [];
  $("#episodeReferenceCount").textContent = ids.length || episode.referencePrompt ? `(${ids.length}${episode.referencePrompt ? " + prompt" : ""})` : "";
  $("#episodeReferences").innerHTML = referencePanelHTML({ scope: "episode", kind: episode.kind, episodeId: episode.id, prompt: episode.referencePrompt || "", itemIds: ids, items: libraryForPanels() });
}
// The object whose references a panel edits: the episode itself or one card (by stable card ID).
function referenceTarget(panel) {
  if (!panel || !episode) return null;
  if (panel.dataset.refScope === "episode") return episode;
  return episode.cards.find((card) => card.id === panel.dataset.refCard) || null;
}
function setReferences(target, ids) {
  target.referenceItemIds = ids;
  dirty = true;
  save();
}
async function uploadReferences(panel, files) {
  const target = referenceTarget(panel);
  if (!target || !files.length) return;
  const episodeId = episode.id, cardId = panel.dataset.refCard || null;
  const status = panel.querySelector("[data-ref-status]");
  try {
    await flushDraft();
    for (const file of files) {
      if (status) status.textContent = `Importing ${file.name}…`;
      // Registers the item in the episode library and links it only to this scope; output media is untouched.
      const item = await uploadLibraryFile({ episodeId, file, category: "Reference" });
      if (episode?.id !== episodeId) return toast(`${file.name} was imported to the previous episode's library.`);
      boardItems = [...boardItems.filter((value) => value.id !== item.id), item];
      const current = cardId ? episode.cards.find((card) => card.id === cardId) : episode;
      if (!current) return toast(`${file.name} was imported to the library, but the card was removed.`);
      current.referenceItemIds = linkReference(current.referenceItemIds, item.id);
      dirty = true;
      await save();
    }
    toast(files.length === 1 ? `${files[0].name} linked as a reference` : `${files.length} references linked`);
  } catch (error) {
    const current = document.querySelector(cardId ? `[data-ref-card="${CSS.escape(cardId)}"] [data-ref-status]` : `[data-ref-scope="episode"] [data-ref-status]`);
    if (current) { current.textContent = error.message; current.classList.add("error"); }
    toast(error.message);
  }
}
function handleReferenceChange(event) {
  const panel = event.target.closest("[data-ref-scope]");
  const target = referenceTarget(panel);
  if (!target) return false;
  if (event.target.matches("[data-ref-prompt]")) { target.referencePrompt = event.target.value; dirty = true; save(); return true; }
  if (event.target.matches("[data-ref-add]")) { if (event.target.value) setReferences(target, linkReference(target.referenceItemIds, event.target.value)); return true; }
  if (event.target.matches("[data-ref-file]")) { const files = [...event.target.files]; event.target.value = ""; uploadReferences(panel, files); return true; }
  return false;
}
function handleReferenceClick(event) {
  const panel = event.target.closest("[data-ref-scope]");
  const target = referenceTarget(panel);
  if (!target) return false;
  const unlink = event.target.closest("[data-ref-unlink]");
  if (unlink) { setReferences(target, unlinkReference(target.referenceItemIds, unlink.dataset.refUnlink)); return true; }
  if (event.target.closest("[data-ref-pick]")) { panel.querySelector("[data-ref-file]").click(); return true; }
  return Boolean(event.target.closest("[data-ref-scope]"));
}
function handleReferenceDrop(event) {
  const drop = event.target.closest("[data-ref-drop]");
  if (!drop || !event.dataTransfer?.files?.length) return false;
  event.preventDefault();
  drop.classList.remove("drag-over");
  uploadReferences(drop.closest("[data-ref-scope]"), [...event.dataTransfer.files]);
  return true;
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
async function refreshBrandingTemplates() {
  try {
    const templates = await api("/api/branding");
    $("#brandingTemplates").innerHTML = templates.map((template) => `<article class="branding-template"><div><b>${esc(template.name)}</b><span>${template.role ? `Standard ${esc(template.role)}` : "Reusable"} · ${esc(template.card.type)}</span></div><div><select data-branding-role="${template.id}"><option value="" ${!template.role ? "selected" : ""}>Reusable</option><option value="intro" ${template.role === "intro" ? "selected" : ""}>Intro</option><option value="outro" ${template.role === "outro" ? "selected" : ""}>Outro</option></select><button data-branding-apply="${template.id}" ${episode ? "" : "disabled"}>Add to episode</button></div></article>`).join("") || "<p>No reusable cards yet. Promote one from the Storyboard.</p>";
    $("#brandingEpisode").textContent = episode ? `Add reusable cards to: ${episode.title}` : "Select an episode on Episodes to add a reusable card.";
  } catch (error) { $("#brandingTemplates").textContent = error.message; }
}
$("#brandingTemplates").onchange = async (event) => {
  const id = event.target.dataset.brandingRole;
  if (!id) return;
  try { await api(`/api/branding/${id}`, { method: "PUT", body: JSON.stringify({ role: event.target.value || null }) }); await refreshBrandingTemplates(); toast("Standard role updated"); }
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
    targetChannel = channelId,
    revision = episode.revision,
    cards = structuredClone(episode.cards),
    referencePrompt = episode.referencePrompt ?? "",
    referenceItemIds = [...(episode.referenceItemIds || [])],
    design = episode.kind === "deck" && episode.design ? { design: structuredClone(episode.design) } : {},
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
          referencePrompt,
          referenceItemIds,
          ...design,
          ...changes,
        }),
      });
      if (channelId !== targetChannel) return updated;
      state.episodes = state.episodes.map((candidate) => candidate.id === target ? updated : candidate);
      if (episode?.id === target) {
        const localCards = episode.cards,
          localReferencePrompt = episode.referencePrompt,
          localReferenceItemIds = episode.referenceItemIds,
          localDesign = episode.design,
          localTitle = $("#episodeTitle").value,
          localNotes = $("#episodeNotes").value;
        episode =
          dirty || saveRequested
            ? {
                ...updated,
                title: localTitle,
                notes: localNotes,
                cards: localCards,
                referencePrompt: localReferencePrompt,
                referenceItemIds: localReferenceItemIds,
                ...(localDesign === undefined ? {} : { design: localDesign }),
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
  // The render inside the save ran while it was still in flight, so the open slide card skipped its load: load it now.
  if (saved && episode?.id === target && episode.kind === "deck" && !dirty && !saveRequested && !saveInFlight && !slideEditor.isOpen) renderSlideList();
  if (saved) await refreshJobs(target).catch((error) => toast(error.message));
  if (saved && (dirty || saveRequested) && episode?.id === target)
    return save();
}
async function flushDraft() {
  if (!(await leaveResearch())) throw new Error("Save or discard research edits before continuing");
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
  if (!(await canLeaveContext())) return;
  if (!channelId) {
    chrome.open('channels');
    $('#newChannel').click();
    return;
  }
  const e = await api("/api/episodes", {
    method: "POST",
    body: JSON.stringify({ title: $("#productionKind").value === "deck" ? "Untitled deck" : "Untitled episode", kind: $("#productionKind").value, channelId }),
  });
  await load(e.id);
  chrome.close({ focus: false });
}
$("#episodes").onclick = async (e) => {
  if (!e.target.closest("[data-episode-select]")) return;
  const id = e.target.closest("[data-id]")?.dataset.id;
  if (id && id !== episode?.id && (await canLeaveContext())) {
    episode = state.episodes.find((x) => x.id === id);
    rememberEpisode();
    render();
    if (!$("#boardPanel").hidden) loadBoardContext().catch((error) => toast(error.message));
    await chatWorkspace.open();
    if (!$("#mediaPanel").hidden) libraryWorkspace.open().catch((error) => toast(error.message));
    chrome.close({ focus: false });
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
  const archived = nextState === "Archived";
  if (!target || (archived ? target.archivedAt : !target.archivedAt && target.state === nextState)) return;
  try {
    if (id === episode?.id) await flushDraft();
    const changes = archived ? { archived: true } : { state: nextState, archived: false };
    const updated = await api(`/api/episodes/${id}`, { method: "PUT", body: JSON.stringify({ expectedRevision: target.revision, ...changes }) });
    state.episodes = state.episodes.map((candidate) => candidate.id === id ? updated : candidate);
    if (episode?.id === id) episode = updated;
    render();
  } catch (error) { toast(error.message); await load(episode?.id); }
}
$("#episodeFilter").onchange = render;
$("#filteredEpisodeNotice").onclick = (event) => { if (event.target.closest("[data-reveal-episode]")) { $("#episodeFilter").value = episode?.archivedAt ? "Archived" : "All"; render(); } };
$("#newEpisode").onclick = $("#firstEpisode").onclick = create;
$("#episodeTitle").oninput = $("#episodeNotes").oninput = () => {
  dirty = true;
  $("#saveState").textContent = "Unsaved changes";
  clearTimeout(fieldTimer);
  fieldTimer = setTimeout(() => save(), 500);
};
// Slides (spec #46): the list of slide cards, and the slide editor around the canvas. The canvas edits
// the deck design and slide overrides in place, then saves like any slide field.
const markDeckDirty = () => { dirty = true; $("#saveState").textContent = "Unsaved changes"; };
const deckLibrary = () => (episode && boardItemsEpisode === episode.id ? boardItems : null);
// Open asset (the visual's toolbar and card): the library's asset preview, over the slide editor.
async function openDeckAsset(id) {
  if (!libraryWorkspace.item(id)) await libraryWorkspace.open();
  libraryWorkspace.openEdit(id);
}
// A canvas change saves; its promise is false when the save was refused (the save state then asks for a reload).
// Reload and retry (a refused text commit) drops the refused local state and loads the latest saved production.
const deckCanvas = createDeckCanvas($("#deckCanvas"), { channel: () => channelId, inspectorHost: $("[data-editor-inspector]"),
  async onChange() { markDeckDirty(); renderCards(); await save().catch(() => {}); return !$("#saveState").textContent.includes("reload"); },
  async onReload() { if (!episode || saveInFlight) return; dirty = false; saveRequested = false; await load(episode.id); },
  getItems: deckLibrary, onOpenAsset: openDeckAsset });
const slideEditor = createSlideEditor($("#slideEditor"), { canvas: deckCanvas, channel: () => channelId, getEpisode: () => episode, getItems: deckLibrary,
  getSections: () => (episode && boardItemsEpisode === episode.id ? boardSections : []), saveState: $("#saveState"),
  onDirty: markDeckDirty, onSave: () => save(), onClose: () => renderCards(), onOpenAsset: openDeckAsset });
// One card is open at a time; its inline preview is the saved slide, so it waits for pending edits to save.
let openSlideId = null, slideListShown = null, slidePreview = null;
function renderSlideList() {
  if (!episode.cards.some((slide) => slide.id === openSlideId)) openSlideId = null;
  const html = slideListHTML(episode.cards, deckLibrary(), openSlideId);
  if (html !== slideListShown) {
    slidePreview?.destroy(); slidePreview = null;
    $("#deckSlides").innerHTML = slideListShown = html;
  }
  const viewport = $("#deckSlides [data-slide-preview]");
  if (!viewport) return;
  slidePreview ||= createSlidePreview(viewport, { channel: () => channelId, onStatus: (text) => { $("#deckSlides [data-slide-preview-status]").textContent = text; } });
  if (!dirty && !saveRequested && !saveInFlight) slidePreview.load(slideFrameUrl(episode, openSlideId));
}
bindSlideList($("#deckSlides"), { getSlides: () => episode.cards, getOpenId: () => openSlideId,
  setOpenId(id) { openSlideId = id; renderSlideList(); },
  onPlay(id) { openSlideId = id; renderSlideList(); slidePreview?.play(); },
  onEdit: (id) => slideEditor.open(id),
  onChange() { markDeckDirty(); renderCards(); save(); } });
$("#addSlide").onclick = () => {
  const slide = newSlide();
  episode.cards.push(slide); openSlideId = slide.id; markDeckDirty(); renderCards(); save();
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
  if (handleReferenceChange(e)) return;
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
  else if (key === "excluded") card[key] = el.checked;
  else if (["duration", "in", "out", "offset", "gain", "fadeIn", "fadeOut"].includes(key)) card[key] = el.value === "" ? null : Number(el.value);
  else card[key] = el.value || (["sectionId", "itemId", "anchorVisualCardId"].includes(key) ? null : "");
  dirty = true;
  save();
};
$("#cards").onclick = (e) => {
  const wrap = e.target.closest(".story-card");
  if (!wrap) return;
  if (e.target.closest("[data-card-collapse]")) {
    const collapsed = collapsedCardIds.has(wrap.dataset.cardId);
    if (collapsed) collapsedCardIds.delete(wrap.dataset.cardId);
    else collapsedCardIds.add(wrap.dataset.cardId);
    const button = wrap.querySelector("[data-card-collapse]");
    button.setAttribute("aria-expanded", String(collapsed));
    button.querySelector("[aria-hidden]").textContent = collapsed ? "▾" : "▸";
    wrap.querySelector(".card-expanded").hidden = !collapsed;
    return;
  }
  const i = Number(wrap.dataset.index);
  if (handleReferenceClick(e)) return;
  if (e.target.closest("[data-card-build]")) return askAssistant("card_build", { targetCardId: episode.cards[i].id }).catch((error) => toast(error.message));
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
$("#cards").ondragstart = (event) => { const handle = event.target.closest(".drag"); if (!handle) return; const card = handle.closest("[data-card-id]"); if (card) event.dataTransfer.setData("text/card-id", card.dataset.cardId); };
$("#cards").ondragover = (event) => {
  const referenceDrop = event.target.closest("[data-ref-drop]");
  if (referenceDrop && [...event.dataTransfer.types].includes("Files")) { event.preventDefault(); referenceDrop.classList.add("drag-over"); return; }
  const mediaDrop = event.target.closest("[data-card-media-drop]");
  if (mediaDrop && [...event.dataTransfer.types].includes("Files")) {
    event.preventDefault();
    mediaDrop.classList.add("drag-over");
  } else if (event.target.closest("[data-card-section]")) event.preventDefault();
};
$("#cards").ondragleave = (event) => event.target.closest("[data-card-media-drop], [data-ref-drop]")?.classList.remove("drag-over");
$("#cards").ondrop = (event) => {
  if (handleReferenceDrop(event)) return;
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
$("#episodeReferences").onchange = handleReferenceChange;
$("#episodeReferences").onclick = handleReferenceClick;
$("#episodeReferences").ondragover = (event) => {
  const drop = event.target.closest("[data-ref-drop]");
  if (drop && [...event.dataTransfer.types].includes("Files")) { event.preventDefault(); drop.classList.add("drag-over"); }
};
$("#episodeReferences").ondragleave = (event) => event.target.closest("[data-ref-drop]")?.classList.remove("drag-over");
$("#episodeReferences").ondrop = handleReferenceDrop;
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
let tabGeneration = 0;
async function showTab(tab, { confirmStory = true, remember = true } = {}) {
      if (episode?.kind === 'deck' && ['drafts', 'final'].includes(tab)) tab = 'board';
      const generation = ++tabGeneration;
      const b = document.querySelector(`.tabs > button[data-tab="${tab}"]`);
      if (!b) return;
      if (confirmStory && b.dataset.tab !== "story" && !(await leaveStory())) return;
      if (b.dataset.tab !== "research" && !(await leaveResearch())) return;
      if (generation !== tabGeneration) return;
      document
        .querySelectorAll(".tabs > button")
        .forEach((x) => x.classList.toggle("active", x === b));
      ["story", "board", "media", "research", "drafts", "final"].forEach(
        (x) => ($(`#${x}Panel`).hidden = b.dataset.tab !== x),
      );
      if (b.dataset.tab === "story" && episode)
        storyEditor.open(episode.id).catch((error) => toast(error.message));
      if (b.dataset.tab === "research" && episode) researchEditor.open(episode.id);
      if (b.dataset.tab === "media" && episode)
        libraryWorkspace.open().catch((error) => toast(error.message));
      if (b.dataset.tab === "board" && episode)
        loadBoardContext().catch((error) => toast(error.message));
      if (remember || location.hash) {
        const target = new URL(location.href); target.hash = tab;
        if (target.href !== location.href) {
          if (remember) { navigationIndex++; history.pushState({ pageIndex: navigationIndex }, '', target); }
          else history.replaceState({ ...history.state, pageIndex: navigationIndex }, '', target);
          currentUrl = target; pageLinks();
        }
      }
}
const tabFromUrl = (url) => ['board', 'story', 'media', 'research', 'drafts', 'final'].includes(url.hash.slice(1)) ? url.hash.slice(1) : 'board';
document.querySelectorAll(".tabs > button").forEach((button) => {
  button.onclick = () => showTab(button.dataset.tab);
});
async function renderJob(kind) {
  try {
    await askAssistant(kind);
  } catch (e) {
    toast(e.message);
  }
}
$("#preview").onclick = () => renderJob("draft");
$("#export").onclick = () => renderJob("final");
function releaseOutputPlayers(ids) {
  for (const id of ids) releasePlayer(document.querySelector(`[data-jobs-list] [data-job-id="${CSS.escape(id)}"] video`));
}
function summarizeDeletion(report) {
  const parts = [`${report.deleted} deleted`, `${formatBytes(report.bytesReclaimed)} reclaimed`];
  if (report.failed) parts.push(`${report.failed} failed`);
  if (report.refused) parts.push(`${report.refused} not deleted`);
  return parts.join(" · ");
}
async function deleteOutputs(outputs) {
  await flushDraft();
  const target = episode.id;
  releaseOutputPlayers(outputs.map((output) => output.id));
  const report = await api(`/api/episodes/${target}/outputs/delete`, { method: "POST", body: JSON.stringify({ outputs }) });
  if (episode?.id === target) await load(target);
  return report;
}
document.querySelectorAll("[data-jobs-list]").forEach((list) => list.onclick = async (event) => {
  const move = event.target.closest("[data-move-to-drafts]");
  const remove = event.target.closest("[data-delete-output]");
  if ((move || remove) && episode) {
    try {
      if (move) {
        await flushDraft();
        await api(`/api/episodes/${episode.id}/outputs/${move.dataset.moveToDrafts}/move-to-drafts`, { method: "POST", body: JSON.stringify({ expectedRevision: Number(move.dataset.revision) }) });
        await load(episode.id);
        toast("Moved to Drafts. The video and its history are unchanged.");
      } else {
        if (!confirm("Delete this draft render? The file is removed; its history stays.")) return;
        const report = await deleteOutputs([{ id: remove.dataset.deleteOutput, expectedRevision: Number(remove.dataset.revision) }]);
        const [result] = report.results;
        toast(result?.status === "deleted" || result?.status === "absent" ? summarizeDeletion(report) : `Not deleted: ${result?.reason || "unknown reason"}`);
      }
    } catch (error) { toast(error.message); await load(episode.id); }
    return;
  }
  const id = event.target.closest("[data-cancel-job]")?.dataset.cancelJob;
  if (!id || !episode) return;
  try { await api(`/api/episodes/${episode.id}/jobs/${id}/cancel`, { method: "POST", body: "{}" }); await load(episode.id); }
  catch (error) { toast(error.message); }
});
let cleanupRows = [], cleanupSelected = new Set(), cleanupOutcomes = new Map();
function renderCleanup() {
  $("#draftCleanupRows").innerHTML = cleanupRowsHTML(cleanupRows, cleanupSelected, cleanupOutcomes);
  $("#draftCleanupTotal").textContent = `${formatBytes(selectedTotal(cleanupRows, cleanupSelected))} (${cleanupSelected.size} selected)`;
  $("#draftCleanupSubmit").disabled = !cleanupSelected.size;
}
async function refreshCleanup() {
  cleanupRows = await api(`/api/episodes/${episode.id}/outputs/cleanup`);
  const present = new Set(cleanupRows.filter((row) => row.eligible).map((row) => row.id));
  cleanupSelected = new Set([...cleanupSelected].filter((id) => present.has(id)));
  renderCleanup();
}
$("#openDraftCleanup").onclick = async () => {
  if (!episode) return;
  cleanupSelected = new Set(); cleanupOutcomes = new Map(); $("#draftCleanupSummary").textContent = "";
  try { await refreshCleanup(); $("#draftCleanupModal").showModal(); } catch (error) { toast(error.message); }
};
document.querySelectorAll("[data-cleanup-close]").forEach((button) => button.onclick = () => $("#draftCleanupModal").close());
$("#draftCleanupRows").onchange = (event) => {
  const id = event.target.dataset.cleanupSelect;
  if (!id) return;
  cleanupSelected = toggleSelection(cleanupRows, cleanupSelected, id, event.target.checked);
  renderCleanup();
};
$("#draftCleanupForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!episode || !cleanupSelected.size) return;
  const outputs = cleanupRows.filter((row) => cleanupSelected.has(row.id)).map((row) => ({ id: row.id, expectedRevision: row.recordRevision }));
  $("#draftCleanupSubmit").disabled = true;
  try {
    const report = await deleteOutputs(outputs);
    cleanupOutcomes = new Map(report.results.map((result) => [result.id, result]));
    // Successful items leave the list; failed or refused ones stay selected for a retry.
    const retained = new Set(report.results.filter((result) => !["deleted", "absent", "alreadyDeleted"].includes(result.status)).map((result) => result.id));
    cleanupSelected = new Set([...cleanupSelected].filter((id) => retained.has(id)));
    $("#draftCleanupSummary").textContent = summarizeDeletion(report);
    await refreshCleanup();
  } catch (error) { $("#draftCleanupSummary").textContent = error.message; renderCleanup(); }
};
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
  try {
    const sent = await askAssistant(kind === "motion" ? "animated_graphic" : "still_graphic", {
      targetCardId: form.elements.cardId.value || null, prompt: form.elements.prompt.value });
    if (sent) { $("#graphicModal").close(); form.reset(); }
  } catch (error) { form.querySelector("[data-graphic-error]").textContent = error.message; }
};
setInterval(async () => {
  if (!episode) return;
  try {
    await researchEditor.refresh();
    if (
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) &&
      state.jobs.some((j) => ["queued", "running"].includes(j.state))
    ) {
      await load(episode.id);
    } else await refreshJobs(episode.id);
  } catch (error) {
    if ([404, 410].includes(error.status)) await navigate(new URL('/episodes', location.href).href, null, { replace: true });
    else toast(error.message);
  }
}, 1800);
window.addEventListener("beforeunload", (event) => {
  if (storyEditor.isDirty() || researchEditor.isDirty() || researchEditor.pending || dirty || saveInFlight || settingsPages.dirty || settingsPages.pending) event.preventDefault();
});
const settingsPages = new SettingsPages({ api, toast, setStatus: (text) => { $("#saveState").textContent = text; } });
const pageFor = (url) => ['branding', 'models', 'providers'].includes(url.pathname.slice(1)) ? url.pathname.slice(1) : 'episodes';
let page = pageFor(new URL(location.href)), navigationIndex = history.state?.pageIndex ?? 0, restoringHistory = false, navigating = false, pendingHistoryNavigation = null;
let currentUrl = new URL(location.href);
history.replaceState({ ...history.state, pageIndex: navigationIndex }, '', currentUrl);
function pageLinks() {
  document.querySelectorAll('[data-page]').forEach((link) => {
    const target = new URL(currentUrl); target.pathname = `/${link.dataset.page}`;
    link.href = target.href;
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
function rememberEpisode() {
  currentUrl = new URL(location.href);
  if (episode) currentUrl.searchParams.set('episode', episode.id);
  else currentUrl.searchParams.delete('episode');
  history.replaceState({ ...history.state, pageIndex: navigationIndex }, '', currentUrl);
  pageLinks();
}
async function showPage(next) {
  page = next;
  $('#episodesPage').hidden = next !== 'episodes';
  $('#brandingPage').hidden = next !== 'branding';
  $('#modelsPage').hidden = next !== 'models';
  $('#providersPage').hidden = next !== 'providers';
  pageLinks();
  await settingsPages.open(next);
  if (next === 'branding') await refreshBrandingTemplates();
}
async function canLeaveContext() {
  const resumeDrawer = chrome.suspend();
  try {
    if (!(await settingsPages.canLeave())) return false;
    const storyChoice = leaveStory();
    const prompt = $('[data-story-leave]');
    if (!prompt.hidden) prompt.querySelector('[data-leave-stay]').focus();
    if (!(await storyChoice)) return false;
    if (!(await leaveResearch())) return false;
    await flushDraft();
    return true;
  } finally { resumeDrawer(); }
}
async function recordChannelOpen(id) {
  if (id) await api(`/api/channels/${encodeURIComponent(id)}/open`, { method: 'POST', body: '{}' });
}
async function navigate(target, popIndex = null, { prepared = false, replace = false } = {}) {
  if (navigating) return false;
  navigating = true;
  let accepted = false, viewChanged = false;
  const oldChannel = channelId, oldEpisode = episode, oldState = state;
  try {
    if (!prepared && !(await canLeaveContext())) return false;
    const nextUrl = new URL(target), nextChannel = nextUrl.searchParams.get('channel');
    const nextEpisode = nextUrl.searchParams.get('episode');
    if (nextChannel !== channelId || nextEpisode !== (episode?.id || null)) {
      viewChanged = true;
      channelId = nextChannel; episode = null;
      await load(nextEpisode, { remember: false });
    }
    if (nextChannel !== oldChannel) await recordChannelOpen(channelId);
    if (channelId) nextUrl.searchParams.set('channel', channelId);
    if (popIndex == null) {
      if (replace) history.replaceState({ ...history.state, pageIndex: navigationIndex }, '', nextUrl);
      else { navigationIndex++; history.pushState({ pageIndex: navigationIndex }, '', nextUrl); }
    } else navigationIndex = popIndex;
    accepted = true; currentUrl = new URL(location.href);
    await showPage(pageFor(currentUrl));
    await showTab(tabFromUrl(currentUrl), { confirmStory: false, remember: false });
    chrome.close({ focus: false });
    if (nextChannel !== oldChannel) ($('#episodeTitle').offsetParent ? $('#episodeTitle') : $('#empty h1')).focus();
    return true;
  } catch (error) {
    if ([404, 410].includes(error.status)) {
      try {
        channelId = null; episode = null; ++loadGeneration;
        await load(null);
        const fallback = new URL('/episodes', location.href);
        if (channelId) fallback.searchParams.set('channel', channelId);
        if (popIndex != null) navigationIndex = popIndex;
        history.replaceState({ ...history.state, pageIndex: navigationIndex }, '', fallback);
        currentUrl = fallback; accepted = true;
        await showPage('episodes'); await recordChannelOpen(channelId);
        chrome.close({ focus: false });
        toast('That channel is unavailable. Showing an available channel.');
        return true;
      } catch { /* Restore the previous view below if fallback cannot load. */ }
    }
    if (viewChanged) {
      channelId = oldChannel; episode = oldEpisode; state = oldState; ++loadGeneration; showChannel(oldState.channel); render();
    }
    toast(error.message);
    return false;
  }
  finally {
    if (!accepted && popIndex != null && !pendingHistoryNavigation) { restoringHistory = true; history.go(navigationIndex - popIndex); }
    navigating = false;
    if (pendingHistoryNavigation) {
      const pending = pendingHistoryNavigation; pendingHistoryNavigation = null;
      navigate(pending.target, pending.index);
    }
  }
}
async function navigateChannel(id, { prepared = false, replace = false } = {}) {
  if (id === channelId && !replace) {
    await recordChannelOpen(id);
    chrome.close({ focus: false });
    ($('#episodeTitle').offsetParent ? $('#episodeTitle') : $('#empty h1')).focus();
    return true;
  }
  const target = new URL('/episodes', location.href);
  if (id) target.searchParams.set('channel', id);
  return navigate(target.href, null, { prepared, replace });
}
const channelDrawer = installChannelDrawer({ api, currentChannel: () => channelId, canLeave: canLeaveContext,
  navigateChannel,
  afterDelete: async (result) => {
    if (result.channelIds.includes(channelId)) await navigateChannel(result.fallbackChannelId, { prepared: true, replace: true });
    else await load(episode?.id);
  },
  afterRename: (updated) => { if (updated.id === channelId) showChannel(updated); }, esc });
const chrome = installWorkspaceChrome(document, {
  onOpenChannels: () => { channelDrawer.reset(); channelDrawer.refresh().catch((error) => toast(error.message)); },
  onCloseChannels: () => channelDrawer.reset(),
  onEscape: () => channelDrawer.cancelTransient(),
});
installProductionSearch({ api, esc, navigate, onOpen: () => chrome.close({ focus: false }) });
document.querySelectorAll('[data-page]').forEach((link) => link.onclick = (event) => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (page === link.dataset.page) return;
  navigate(link.href);
});
window.addEventListener('popstate', (event) => {
  if (restoringHistory) { restoringHistory = false; return; }
  if (navigating) { pendingHistoryNavigation = { target: location.href, index: event.state?.pageIndex ?? 0 }; return; }
  navigate(location.href, event.state?.pageIndex ?? 0);
});
load(new URL(location.href).searchParams.get('episode')).catch(async (error) => {
  if (error.status !== 404 && error.status !== 410) throw error;
  toast('This channel is unavailable. Showing an available channel.');
  channelId = null; episode = null;
  const next = new URL(location.href); next.searchParams.delete('channel'); next.searchParams.delete('episode');
  history.replaceState(history.state, '', next);
  await load(null);
}).then(async () => {
  currentUrl = new URL(location.href);
  await showPage(page);
  await showTab(tabFromUrl(currentUrl), { confirmStory: false, remember: false });
  await recordChannelOpen(channelId);
}).catch((error) => toast(error.message));

$('#buildDeck').onclick = async () => {
  try {
    $('#deckBuildError').textContent = '';
    if (!(await leaveStory())) throw new Error("Save or discard story edits before building");
    await flushDraft();
    await api(`/api/episodes/${episode.id}/deck-build`,{method:'POST',body:JSON.stringify({expectedRevision:episode.revision})});
    await refreshJobs();
  } catch (error) { $('#deckBuildError').textContent = error.message; }
};
$('#deckJobs').onclick = async event => {
  const cancel = event.target.dataset.deckCancel;
  if (cancel) try { await api(`/api/episodes/${episode.id}/jobs/${cancel}/cancel`,{method:'POST',body:'{}'}); await refreshJobs(); } catch (error) { toast(error.message); }
};
