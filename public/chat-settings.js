// Harness / model / effort selection for one Storybench conversation (spec #11 "Selection
// and availability"). Options come from GET /api/harnesses (installed-harness discovery and the
// live login); a change is PUT to the conversation and shows as a boundary in the transcript.
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
export const HARNESS_LABELS = { codex: "Codex", claude: "Claude Code" };

export function selectionLabel(settings) {
  if (!settings) return "Codex · default model";
  const harness = HARNESS_LABELS[settings.harness] ?? settings.harness;
  return [harness, settings.model || "default model", settings.effort ? `${settings.effort} effort` : null].filter(Boolean).join(" · ");
}

// Effort options for a harness entry and chosen model: the model's own list, else (for an
// unlisted exact ID) only the native default.
export function effortOptions(entry, modelId) {
  if (!entry) return [];
  const listed = entry.models.find((model) => model.id === modelId);
  if (listed) return listed.efforts ?? [];
  if (!modelId) return (entry.models.find((model) => model.isDefault)?.efforts) ?? entry.efforts ?? [];
  return entry.harness === "claude" ? entry.efforts ?? [] : [];
}

export function boundaryText(event) {
  const payload = event.payload ?? {};
  if (event.type === "settings.changed") {
    const to = selectionLabel(payload.to), from = selectionLabel(payload.from);
    const continuity = payload.continuity === "new-segment-on-next-message" ? "The next message starts a new native session with a summary of this conversation." : "The next message continues the same session.";
    return `Settings changed from ${from} to ${to}. ${continuity}`;
  }
  if (event.type === "segment.started") {
    const why = { "harness-switch": "after switching harness", "harness-return": "after returning to this harness", initial: "for this conversation", "resume-unavailable": "because the previous session could not be resumed" }[payload.reason] ?? "";
    return `New ${HARNESS_LABELS[payload.harness] ?? payload.harness ?? ""} session ${why}; seeded with ${payload.includedMessages ?? 0} earlier messages${payload.omittedMessages ? ` (${payload.omittedMessages} older available on request)` : ""}. Earlier prompts were not re-run.`;
  }
  return null;
}

export class ChatSettings {
  constructor({ root, api, toast = () => {} }) {
    Object.assign(this, { root, api, toast });
    this.catalog = null;
    this.catalogError = null;
  }

  async loadCatalog({ refresh = false } = {}) {
    try {
      this.catalog = await this.api(`/api/harnesses${refresh ? "?refresh=1" : ""}`);
      this.catalogError = null;
    } catch (cause) { this.catalogError = cause.message; }
    return this.catalog;
  }

  entry(harness) { return this.catalog?.harnesses?.find((value) => value.harness === harness) ?? null; }

  // Render the editor for `conversation` into the panel; resolves with the saved conversation or null.
  open(panel, conversation, { busy = false, onSaved = () => {} } = {}) {
    const settings = conversation.settings ?? { harness: "codex", model: null, effort: null, revision: 1 };
    const unavailable = !this.catalog?.available;
    panel.hidden = false;
    panel.innerHTML = `<form class="chat-settings" data-chat-settings-form>
      <fieldset ${unavailable || busy ? "disabled" : ""}>
        <label>Harness <select name="harness" data-settings-harness></select></label>
        <label>Model <input name="model" data-settings-model list="chatModelOptions" autocomplete="off" placeholder="Harness default"><datalist id="chatModelOptions" data-settings-models></datalist></label>
        <label>Thinking <select name="effort" data-settings-effort></select></label>
      </fieldset>
      <p class="chat-settings-note" data-settings-note role="status"></p>
      <div class="chat-settings-actions"><button type="button" data-settings-refresh>Refresh models</button><button type="button" data-settings-cancel>Cancel</button><button type="submit" data-settings-apply ${unavailable || busy ? "disabled" : ""}>Apply</button></div>
    </form>`;
    const form = panel.querySelector("form"), harness = form.querySelector("[data-settings-harness]"), model = form.querySelector("[data-settings-model]"),
      effort = form.querySelector("[data-settings-effort]"), note = form.querySelector("[data-settings-note]"), list = form.querySelector("[data-settings-models]");
    const paintHarnesses = () => {
      harness.innerHTML = ["codex", "claude"].map((id) => {
        const entry = this.entry(id);
        const reason = !entry ? "not listed" : entry.available ? "" : entry.reason;
        return `<option value="${id}" ${entry?.available ? "" : "disabled"} ${id === harness.value || (!harness.value && id === settings.harness) ? "selected" : ""}>${escapeHtml(HARNESS_LABELS[id])}${reason ? ` — unavailable: ${escapeHtml(reason)}` : ""}</option>`;
      }).join("");
    };
    const paintModels = () => {
      const entry = this.entry(harness.value);
      list.innerHTML = (entry?.models ?? []).map((value) => `<option value="${escapeHtml(value.id)}">${escapeHtml(value.displayName ?? value.id)}${value.isDefault ? " (default)" : ""}${entry.advisory ? " — advisory" : ""}</option>`).join("");
      const choices = effortOptions(entry, model.value.trim() || null);
      const current = effort.value || (harness.value === settings.harness ? settings.effort ?? "" : "");
      effort.innerHTML = `<option value="">Native default</option>${choices.map((value) => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
      if (!choices.includes(current)) effort.value = "";
      const parts = [];
      if (busy) parts.push("A turn is running for this episode. Let it finish or press Stop before changing settings.");
      if (unavailable) parts.push(this.catalog?.reason || this.catalogError || "Harness selection is unavailable.");
      if (entry?.advisory) parts.push(entry.note || "Claude model names are advisory; exact IDs are verified on first use.");
      if (entry?.stale) parts.push(`Model list may be stale${entry.discoveryError ? ` (${entry.discoveryError})` : ""}; use Refresh models.`);
      if (entry && !entry.available) parts.push(`${HARNESS_LABELS[entry.harness]} is unavailable: ${entry.reason}`);
      if (harness.value !== settings.harness) parts.push("Switching harness starts a new native session on the next message, seeded with a summary of this conversation.");
      note.textContent = parts.join(" ");
    };
    harness.value = settings.harness;
    paintHarnesses();
    harness.value = settings.harness;
    model.value = settings.model ?? "";
    paintModels();
    harness.onchange = () => { model.value = ""; effort.value = ""; paintModels(); };
    model.oninput = () => paintModels();
    form.querySelector("[data-settings-cancel]").onclick = () => { panel.hidden = true; panel.innerHTML = ""; };
    form.querySelector("[data-settings-refresh]").onclick = async () => {
      note.textContent = "Refreshing models…";
      await this.loadCatalog({ refresh: true });
      paintHarnesses(); paintModels();
    };
    // One client request ID per opened editor makes a double submit idempotent.
    const clientRequestId = globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);
    form.onsubmit = async (event) => {
      event.preventDefault();
      const apply = form.querySelector("[data-settings-apply]");
      apply.disabled = true;
      try {
        const saved = await this.api(`/api/episodes/${conversation.episodeId}/chats/${conversation.id}/settings`, { method: "PUT",
          body: JSON.stringify({ harness: harness.value, model: model.value.trim() || null, effort: effort.value || null, expectedRevision: settings.revision, clientRequestId }) });
        panel.hidden = true; panel.innerHTML = "";
        onSaved(saved);
      } catch (cause) {
        note.textContent = cause.message;
        apply.disabled = false;
      }
    };
  }
}
