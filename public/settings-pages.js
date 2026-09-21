import { ChatSettings, selectionLabel } from './chat-settings.js';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class SettingsPages {
  constructor({ api, toast, setStatus }) {
    Object.assign(this, { api, toast, setStatus });
    this.dirty = false;
    this.pending = null;
    // Track default-model saves too, so navigation cannot race a save.
    this.models = new ChatSettings({ api: (url, options) => {
      if (options?.method !== 'PUT') return api(url, options);
      this.pending = api(url, options).finally(() => { this.pending = null; });
      return this.pending;
    }, toast });
  }
  changed() { this.dirty = true; this.setStatus('Unsaved changes'); }
  async canLeave() {
    if (this.pending) {
      try { await this.pending; } catch { return false; }
    }
    return !this.dirty || window.confirm('Discard unsaved settings changes?');
  }
  async open(page) {
    this.dirty = false;
    this.setStatus('Ready');
    if (page === 'branding') await this.openBranding();
    if (page === 'models') await this.openModels();
  }
  async openBranding() {
    const root = document.querySelector('#standardsEditor');
    root.innerHTML = '<p>Loading standards…</p>';
    try {
      const [value, fonts] = await Promise.all([this.api('/api/brand-standards'), this.api('/api/fonts')]);
      for (const font of fonts.filter((font) => font.available)) {
        for (const [weight, key] of [[400, 'regular'], [700, 'bold']]) {
          if ([...document.fonts].some((face) => face.family === font.family && face.weight === String(weight))) continue;
          document.fonts.add(new FontFace(font.family, `url("${font.urls[key]}")`, { weight: String(weight) }));
        }
      }
      root.innerHTML = `<form id="standardsForm" class="settings-card">
        <h2>Colors <small>Up to three</small></h2><div class="standards-grid">${[0, 1, 2].map((i) => `<label>${['Base color', 'Accent color', 'Background color'][i]}<div class="color-field"><input type="color" data-swatch="${i}" aria-label="Pick ${['base', 'accent', 'background'][i]} color" value="${value.colors[i] || '#ffffff'}"><input name="color${i}" data-color="${i}" aria-label="${['Base', 'Accent', 'Background'][i]} color hex" placeholder="#1255FF" pattern="#[0-9a-fA-F]{6}" maxlength="7" value="${esc(value.colors[i] || '')}"><button type="button" data-clear-color="${i}" aria-label="Clear ${['base', 'accent', 'background'][i]} color">×</button></div></label>`).join('')}</div>
        <h2>Fonts <small>Up to three</small></h2><div class="standards-grid">${[0, 1, 2].map((i) => `<label>${['Base font', 'Accent font', 'Alternate font'][i]}<select name="font${i}" data-font="${i}"><option value="">No font selected</option>${fonts.map((font) => `<option value="${esc(font.family)}" ${value.fonts[i] === font.family ? 'selected' : ''} ${font.available ? '' : 'disabled'}>${esc(font.family)}${font.available ? '' : ' — unavailable'}</option>`).join('')}</select><span class="font-preview" data-font-preview="${i}">The story starts here.<br><b>Make it yours.</b></span></label>`).join('')}</div>
        <h2>Channel style prompt</h2><label class="style-direction">Creative direction<textarea name="stylePrompt" maxlength="10000" rows="5" placeholder="Describe the channel’s look, pacing, tone and recurring visual choices…">${esc(value.stylePrompt)}</textarea></label>
        <p class="help">Standards guide new and revised work. Specific episode or card instructions can override them.</p>
        <div class="settings-actions"><button class="primary" type="submit">Save standards</button><button type="button" data-standards-reload>Reload saved</button><span class="error" role="alert" data-standards-error></span></div>
      </form>`;
      const form = root.querySelector('form');
      const preview = () => form.querySelectorAll('[data-font]').forEach((select) => {
        const sample = form.querySelector(`[data-font-preview="${select.dataset.font}"]`);
        sample.style.fontFamily = select.value ? `"${select.value}"` : 'inherit';
        sample.hidden = !select.value;
      });
      preview();
      form.oninput = (event) => {
        if (event.target.dataset.swatch != null) form.elements[`color${event.target.dataset.swatch}`].value = event.target.value.toUpperCase();
        if (event.target.dataset.color != null && /^#[0-9a-f]{6}$/i.test(event.target.value)) form.querySelector(`[data-swatch="${event.target.dataset.color}"]`).value = event.target.value;
        this.changed(); preview();
      };
      form.onchange = () => { this.changed(); preview(); };
      form.onclick = (event) => {
        const index = event.target.dataset.clearColor;
        if (index == null) return;
        form.elements[`color${index}`].value = ''; this.changed();
      };
      form.querySelector('[data-standards-reload]').onclick = async () => { if (await this.canLeave()) await this.open('branding'); };
      form.onsubmit = async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]'), error = form.querySelector('[data-standards-error]');
        const body = { expectedRevision: value.revision, stylePrompt: form.elements.stylePrompt.value,
          colors: [0, 1, 2].map((i) => form.elements[`color${i}`].value.trim() || null),
          fonts: [0, 1, 2].map((i) => form.elements[`font${i}`].value || null) };
        for (const slots of [body.colors, body.fonts]) while (slots.at(-1) === null) slots.pop();
        // Lock inputs during a save so a later response cannot discard newly typed edits.
        const controls = [...form.querySelectorAll('input,select,textarea,button')];
        controls.forEach((control) => { control.disabled = true; }); error.textContent = ''; this.setStatus('Saving…');
        try {
          this.pending = this.api('/api/brand-standards', { method: 'PUT', body: JSON.stringify(body) });
          const saved = await this.pending;
          value.revision = saved.revision; this.dirty = false; this.setStatus('Standards saved'); this.toast('Brand Standards saved');
        } catch (cause) { error.textContent = cause.message; this.setStatus('Not saved'); }
        finally { this.pending = null; controls.forEach((control) => { control.disabled = false; }); submit.disabled = false; }
      };
    } catch (cause) { root.innerHTML = `<p class="error">${esc(cause.message)}</p>`; }
  }
  async openModels() {
    const root = document.querySelector('#defaultModelEditor');
    root.innerHTML = '<p>Loading models…</p>';
    try {
      const [value] = await Promise.all([this.api('/api/model-default'), this.models.loadCatalog()]);
      document.querySelector('#defaultModelSummary').textContent = value.selection ? `Saved default: ${selectionLabel(value.selection)}` : 'No app default saved yet. Until you save one, new conversations inherit the last conversation choice.';
      this.models.open(root, { settings: { ...(value.selection || { harness: 'codex', model: null, effort: null }), revision: value.revision } }, {
        defaultMode: true, onDirty: () => this.changed(),
        onCancel: async () => { if (await this.canLeave()) await this.open('models'); },
        onSaved: async () => { this.dirty = false; await this.openModels(); this.setStatus('Default model saved'); this.toast('Default saved for new conversations'); },
      });
    } catch (cause) { root.innerHTML = `<p class="error">${esc(cause.message)}</p>`; }
  }
}
