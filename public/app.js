import { StoryEditor } from "/story-editor.js?v=round2-editor";
import { LibraryWorkspace, episodeNavigatorHTML } from "/library-workspace.js";

const $ = (s) => document.querySelector(s);
let state = { episodes: [], assets: [], jobs: [] },
  episode = null,
  chatTimer = null,
  fieldTimer,
  dirty = false,
  saveInFlight = null,
  saveRequested = false;
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
  $("#jobCount").textContent =
    state.jobs.filter(
      (j) =>
        j.episodeId === episode.id && ["queued", "running"].includes(j.state),
    ).length || "";
  $("#cards").innerHTML =
    episode.cards.map((c, i) => cardHTML(c, i)).join("") ||
    '<div class="welcome">No cards yet. Add a card to begin planning—even before media arrives.</div>';
  const jobs = state.jobs.filter((j) => j.episodeId === episode.id);
  $("#jobs").innerHTML =
    jobs
      .map(
        (j) =>
          `<div class="job"><div><b>${esc(j.kind)}</b> · revision ${j.revision}<br><span class="${j.state === "failed" ? "failed" : ""}">${esc(j.error || j.state)} ${j.state === "running" ? Math.round(j.progress * 100) + "%" : ""}</span>${j.state === "completed" ? `<video controls preload="metadata" src="/api/jobs/${j.id}/file" style="display:block;max-width:420px;width:100%;margin-top:8px"></video>` : ""}</div>${j.state === "completed" ? `<a href="/api/jobs/${j.id}/file" target="_blank"><button>Open</button></a>` : ""}</div>`,
      )
      .join("") || "<p>No renders yet.</p>";
  if (!$("#storyPanel").hidden)
    storyEditor.open(episode.id).catch((error) => toast(error.message));
}

const storyEditor = new StoryEditor({
  root: $("#storyPanel"),
  api,
  setStatus: (text) => { $("#saveState").textContent = text; },
  toast,
});
const libraryWorkspace = new LibraryWorkspace({ api, toast, getEpisode: () => episode });

async function leaveStory() {
  const choice = await storyEditor.requestLeave();
  return choice !== "stay";
}
function opts(kind, selected) {
  return (
    `<option value="">No source</option>` +
    state.assets
      .filter((a) =>
        kind === "visual"
          ? ["video", "image"].includes(a.kind)
          : ["video", "audio"].includes(a.kind) && a.metadata?.hasAudio,
      )
      .map(
        (a) =>
          `<option value="${a.id}" ${a.id === selected ? "selected" : ""}>${esc(a.name)}</option>`,
      )
      .join("")
  );
}
function place(p, kind) {
  const v = p || { assetId: "", in: 0, out: 5, offset: 0, gain: 1 };
  return `<div class="placement"><label>${kind === "visual" ? "Picture + source audio" : "Narration layer"}</label><select data-place="${kind}" data-key="assetId">${opts(kind, v.assetId)}</select><div class="timing"><label><span>In</span><input type="number" min="0" step=".033" value="${v.in}" data-place="${kind}" data-key="in"></label><label><span>Out</span><input type="number" min="0" step=".033" value="${v.out}" data-place="${kind}" data-key="out"></label><label><span>Offset</span><input type="number" min="0" step=".033" value="${v.offset}" data-place="${kind}" data-key="offset" ${kind === "visual" ? "disabled" : ""}></label><label><span>Gain</span><input type="number" min="0" max="8" step=".1" value="${v.gain}" data-place="${kind}" data-key="gain"></label></div></div>`;
}
function cardHTML(c, i) {
  return `<article class="story-card" data-index="${i}"><div class="drag">⋮⋮</div><div class="card-main"><input class="card-title" data-key="title" value="${esc(c.title)}" placeholder="Scene title"><input class="card-purpose" data-key="purpose" value="${esc(c.purpose)}" placeholder="What does this scene accomplish?"><div class="timing" style="grid-template-columns:2fr 2fr 1fr"><label><span>Notes</span><input data-key="notes" value="${esc(c.notes)}" placeholder="Beat or transition"></label><label><span>Missing material</span><input data-key="missing" value="${esc(c.missing)}" placeholder="Optional pickup"></label><label><span>Duration</span><input data-key="duration" type="number" min=".033" step=".033" value="${c.duration ?? ""}" placeholder="auto"></label></div><div class="placements">${place(c.visual, "visual")}${place(c.narration, "narration")}</div></div><div class="card-tools"><button data-move="-1" title="Move up">↑</button><button data-move="1" title="Move down">↓</button><button data-delete title="Delete">×</button></div></article>`;
}
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
    refreshChat();
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
    purpose: "",
    notes: "",
    missing: "",
    visual: null,
    narration: null,
    duration: null,
  });
  dirty = true;
  save();
};
$("#cards").onchange = (e) => {
  const el = e.target,
    wrap = el.closest(".story-card");
  if (!wrap) return;
  const card = episode.cards[Number(wrap.dataset.index)];
  if (el.dataset.place) {
    const kind = el.dataset.place;
    if (el.dataset.key === "assetId") {
      if (!el.value) card[kind] = null;
      else
        card[kind] = {
          assetId: el.value,
          in: 0,
          out: Math.min(
            5,
            state.assets.find((a) => a.id === el.value)?.duration || 5,
          ),
          offset: 0,
          gain: 1,
        };
    } else {
      card[kind] ??= { assetId: "", in: 0, out: 5, offset: 0, gain: 1 };
      card[kind][el.dataset.key] = Number(el.value);
    }
  } else if (el.dataset.key)
    card[el.dataset.key] =
      el.dataset.key === "duration"
        ? el.value === ""
          ? null
          : Number(el.value)
        : el.value;
  dirty = true;
  save();
};
$("#cards").onclick = (e) => {
  const wrap = e.target.closest(".story-card");
  if (!wrap) return;
  const i = Number(wrap.dataset.index);
  if (e.target.closest("[data-delete]")) episode.cards.splice(i, 1);
  else if (e.target.closest("[data-move]")) {
    const n = i + Number(e.target.closest("[data-move]").dataset.move);
    if (n < 0 || n >= episode.cards.length) return;
    [episode.cards[i], episode.cards[n]] = [episode.cards[n], episode.cards[i]];
  } else return;
  dirty = true;
  save();
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
document.querySelectorAll(".tabs > button").forEach(
  (b) =>
    (b.onclick = async () => {
      if (b.dataset.tab !== "story" && !(await leaveStory())) return;
      document
        .querySelectorAll(".tabs > button")
        .forEach((x) => x.classList.toggle("active", x === b));
      ["story", "board", "media", "exports"].forEach(
        (x) => ($(`#${x}Panel`).hidden = b.dataset.tab !== x),
      );
      if (b.dataset.tab === "story" && episode)
        storyEditor.open(episode.id).catch((error) => toast(error.message));
      if (b.dataset.tab === "media" && episode)
        libraryWorkspace.open().catch((error) => toast(error.message));
    }),
);
async function renderJob(kind) {
  try {
    await flushDraft();
    await api(`/api/episodes/${episode.id}/render`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    });
    toast(`${kind} queued`);
    await load(episode.id);
  } catch (e) {
    toast(e.message);
  }
}
$("#preview").onclick = () => renderJob("preview");
$("#export").onclick = () => renderJob("export");
setInterval(() => {
  if (
    episode &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(
      document.activeElement?.tagName,
    ) &&
    state.jobs.some((j) => ["queued", "running"].includes(j.state))
  )
    load(episode.id);
}, 1800);
function drawChat(s) {
  $("#chatStatus").textContent = s.error || s.state || "Ready";
  $("#stopChat").hidden = !["queued", "running", "interrupting"].includes(
    s.state,
  );
  const msgs = s.messages || [];
  $("#messages").innerHTML =
    '<div class="welcome">Ask for help shaping the arc, renaming cards, or reorganizing the storyboard. Your message and project context are sent to your configured Codex provider.</div>' +
    msgs
      .map(
        (m) =>
          `<div class="message ${esc(m.role)}">${esc(m.text || m.content || "")}</div>`,
      )
      .join("");
  $("#messages").scrollTop = $("#messages").scrollHeight;
}
async function refreshChat() {
  if (!episode) return;
  const target = episode.id;
  try {
    const s = await api(`/api/episodes/${target}/chat`);
    if (episode?.id !== target) return;
    drawChat(s);
    if (["queued", "running", "interrupting"].includes(s.state)) {
      clearTimeout(chatTimer);
      chatTimer = setTimeout(refreshChat, 900);
    } else await load(target);
  } catch (e) {
    $("#chatStatus").textContent = e.message;
  }
}
$("#chatForm").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("#chatText").value.trim();
  if (!text || !episode) return;
  $("#chatText").value = "";
  try {
    await flushDraft();
    drawChat(
      await api(`/api/episodes/${episode.id}/chat`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    );
    refreshChat();
  } catch (e) {
    toast(e.message);
  }
};
$("#stopChat").onclick = async () => {
  if (episode)
    drawChat(
      await api(`/api/episodes/${episode.id}/chat/interrupt`, {
        method: "POST",
        body: "{}",
      }),
    );
};
window.addEventListener("beforeunload", (event) => {
  if (storyEditor.isDirty()) event.preventDefault();
});
load().catch((e) => toast(e.message));
