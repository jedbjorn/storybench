// Browser adaptation of RST's palette / recent colors / hex / screen-pick layout:
// https://github.com/jedbjorn/rst-c/tree/main/src/RST.UI/Swatches
const palette = ['#FFFFFF', '#D1D5DB', '#6B7280', '#111827', '#EF4444', '#F97316',
  '#FACC15', '#22C55E', '#14B8A6', '#3B82F6', '#8B5CF6', '#EC4899'];
// Like RST, keep at most twelve unique choices for this session.
const recent = [];
const normalize = (value) => /^#?[0-9a-f]{6}$/i.test(value.trim()) ? `#${value.trim().replace(/^#/, '').toUpperCase()}` : null;

export function openColorPicker({ trigger, value, onPick }) {
  const doc = trigger.ownerDocument, win = doc.defaultView;
  const current = normalize(value) || '#FFFFFF';
  const dialog = doc.createElement('dialog');
  dialog.className = 'color-picker';
  dialog.setAttribute('aria-label', trigger.getAttribute('aria-label'));
  dialog.innerHTML = `<form novalidate>
    <h2>Choose a color</h2>
    <fieldset><legend>Palette</legend><div class="color-picker-swatches" data-palette></div></fieldset>
    <fieldset ${recent.length ? '' : 'hidden'}><legend>Recent colors</legend><div class="color-picker-swatches" data-recent></div></fieldset>
    <label class="color-picker-label" for="pickerHex">Hex color</label>
    <div class="color-picker-hex"><span class="color-picker-preview" aria-label="Color preview"></span><input id="pickerHex" aria-describedby="pickerError" value="${current}" maxlength="7" autocomplete="off" spellcheck="false"><button type="submit" class="primary">Apply</button></div>
    <p id="pickerError" class="error" role="alert"></p>
    <div class="color-picker-actions"><button type="button" data-more>More colors…</button><button type="button" data-screen ${win.EyeDropper ? '' : 'hidden'}>Pick from screen</button><button type="button" data-cancel>Cancel</button></div>
    <input type="color" class="color-picker-native" value="${current}" tabindex="-1" aria-hidden="true">
  </form>`;
  const hex = dialog.querySelector('#pickerHex'), error = dialog.querySelector('#pickerError');
  const preview = dialog.querySelector('.color-picker-preview');
  preview.style.backgroundColor = current;
  function pick(color) {
    if (!dialog.open) return;
    const index = recent.indexOf(color);
    if (index !== -1) recent.splice(index, 1);
    recent.unshift(color); recent.length = Math.min(recent.length, 12);
    dialog.close(); onPick(color);
  }
  for (const [selector, colors] of [['[data-palette]', palette], ['[data-recent]', recent]]) {
    dialog.querySelector(selector).replaceChildren(...colors.map((color) => {
      const button = doc.createElement('button');
      button.type = 'button'; button.className = 'color-picker-swatch';
      button.style.backgroundColor = color; button.title = color;
      button.setAttribute('aria-label', color); button.setAttribute('aria-pressed', String(color === current));
      button.onclick = () => pick(color);
      return button;
    }));
  }
  hex.oninput = () => {
    error.textContent = ''; hex.removeAttribute('aria-invalid');
    const color = normalize(hex.value);
    if (color) preview.style.backgroundColor = color;
  };
  dialog.querySelector('form').onsubmit = (event) => {
    event.preventDefault();
    const color = normalize(hex.value);
    if (color) return pick(color);
    error.textContent = 'Enter six hex digits, for example #1255FF.';
    hex.setAttribute('aria-invalid', 'true'); hex.focus();
  };
  const native = dialog.querySelector('input[type="color"]');
  dialog.querySelector('[data-more]').onclick = () => { native.value = normalize(hex.value) || current; native.click(); };
  native.onchange = () => pick(native.value.toUpperCase());
  dialog.querySelector('[data-screen]').onclick = async () => {
    error.textContent = '';
    try {
      const result = await new win.EyeDropper().open();
      pick(normalize(result.sRGBHex));
    } catch (cause) {
      if (cause.name !== 'AbortError') error.textContent = 'Could not pick a screen color. Try again or enter a hex color.';
    }
  };
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { dialog.remove(); if (trigger.isConnected) trigger.focus(); }, { once: true });
  doc.body.append(dialog); dialog.showModal(); hex.focus(); hex.select();
}
