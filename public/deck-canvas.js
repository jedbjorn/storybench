// Slides canvas (spec #44, Editing by selection). The open slide is shown exactly as the build renders
// it: an inert, sandboxed frame of the saved slide built by the deck template (server route
// deck-canvas), held at a stage by its bridge script. Selection is drawn over the frame from the block
// boxes the bridge reports, using the shared UI primitives; changes edit the deck design or the slide's
// overrides and are saved through the normal save, after which the frame shows the new revision.
// The slide editor (spec #46) hosts this canvas: Play slide runs the slide's timeline in the frame and
// the step bar (Start, 1 … n−1, All) follows it; Play step replays one step. Double-clicking text on the
// slide edits it in the frame itself (Text on the slide): the frame is live only for that edit, and a
// commit is one save. A toolbar above the selection (below it when there is no room above) holds the
// selected element's arguments, with This slide / All slides; the inspector keeps the slide and deck
// values. A selected copy or stage text block on a slide with a visual drags onto one of four drop zones
// around the visual to set its position.
import { createSelectionSurface } from './ui/selection-surface.js';
import { createInspectorPanel } from './ui/inspector-panel.js';
import { createSegmentedChoice } from './ui/segmented-choice.js';
import { createPositionPicker } from './ui/position-picker.js';
import { createAlignmentGrid } from './ui/alignment-grid.js';
import { createDurationField } from './ui/duration-field.js';
import { createScopeSwitch } from './ui/scope-switch.js';
import { openColorPicker } from './color-picker.js';

const BLOCKS = { copy: 'Title and text', stageText: 'Stage text', visual: 'Visual' };
// The primitives each view edits: the toolbar's per block; '' is the inspector's slide and deck view.
const VIEW_PRIMITIVES = { copy: ['copy', 'type'], stageText: ['stageText'], '': ['type', 'spacing', 'timing'] };
// The drop zones around the visual, as fractions of its box: [left, top, width, height].
const ZONES = [['left', 'Left', [0, 0.25, 0.3, 0.5]], ['right', 'Right', [0.7, 0.25, 0.3, 0.5]], ['top', 'Above', [0.3, 0, 0.4, 0.3]], ['bottom', 'Below', [0.3, 0.7, 0.4, 0.3]]];
const ALIGN_NAMES = { rows: { start: 'Top', center: 'Middle', end: 'Bottom' }, cols: { start: 'left', center: 'centre', end: 'right' } };
const alignName = (value) => !value ? 'Template' : value.align === 'center' && value.valign === 'center' ? 'Centred' : `${ALIGN_NAMES.rows[value.valign]} ${ALIGN_NAMES.cols[value.align]}`;
const COLOR_ROLES = [['base', 'Base color'], ['accent', 'Accent color'], ['background', 'Background color']];
const FONT_ROLES = [['base', 'Base font'], ['accent', 'Accent font'], ['alternate', 'Alternate font']];
const STYLES = [['chips', 'Chips'], ['steps', 'Steps'], ['list', 'List'], ['card', 'Card']];
const SCALES = [['compact', 'Compact'], ['standard', 'Standard'], ['large', 'Large']];
const DENSITIES = [['compact', 'Compact'], ['standard', 'Standard'], ['spacious', 'Spacious']];
// Until the frame reports it, assume the bundle's slide area at 1280 x 720 (rail 224 px, footer 72 px).
const AREA = { left: 224, top: 0, width: 1056, height: 648 };

// The canvas build of one saved slide; null until the production has a saved revision.
export function slideFrameUrl(episode, slideId, standards = 0) {
  if (!episode || !Number.isInteger(episode.revision)) return null;
  return `/api/episodes/${encodeURIComponent(episode.id)}/deck-canvas/${episode.revision}/${encodeURIComponent(slideId)}/index.html?standards=${standards}`;
}
// An inert, sandboxed canvas frame of `url`; its bridge reports to the caller's message listener.
function canvasFrame(doc, url, title) {
  const frame = doc.createElement('iframe');
  Object.assign(frame, { title, tabIndex: -1, inert: true });
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.className = 'deck-canvas-frame is-loading';
  frame.src = url;
  return frame;
}
// The build can refuse a slide the editor holds mid-way (for example columns with one item): say why.
async function canvasRefusal(url, channel) {
  const headers = channel ? { 'x-storybench-channel': channel } : {};
  const response = await fetch(url, { method: 'HEAD', headers }).catch(() => null);
  if (response?.ok) return null;
  return (response && (await fetch(url, { headers }).then((r) => r.json()).catch(() => ({}))).error) || 'This slide could not be shown. Save, then reopen it.';
}

// The slide list's inline preview (spec #46, Slide List): the slide as the canvas renders it, held at
// the full reveal and cropped to the slide area, with Play running its timeline. Nothing is selectable.
export function createSlidePreview(viewport, { channel = () => null, onStatus = () => {} } = {}) {
  const doc = viewport.ownerDocument;
  let frame = null, url = null, area = AREA, ready = false, wantsPlay = false;
  function place() {
    const scale = Math.min(1, (viewport.clientWidth || area.width) / area.width);
    viewport.style.height = `${Math.round(area.height * scale)}px`;
    if (frame) frame.style.transform = `translate(${-area.left * scale}px, ${-area.top * scale}px) scale(${scale})`;
  }
  function receive(event) {
    const data = event.data;
    if (!frame || event.source !== frame.contentWindow || data?.type !== 'storybench-canvas' || data.version !== 1) return;
    area = data.area || AREA;
    frame.classList.remove('is-loading');
    if (!ready && wantsPlay) frame.contentWindow.postMessage({ type: 'storybench-canvas-play' }, '*');
    ready = true; wantsPlay = false;
    place();
  }
  doc.defaultView.addEventListener('message', receive);
  const observer = new ResizeObserver(place);
  observer.observe(viewport);
  place();
  return {
    async load(next) {
      if (!next || next === url) return;
      url = next;
      const refusal = await canvasRefusal(next, channel());
      if (url !== next) return;
      onStatus(refusal || '');
      if (refusal) return;
      frame?.remove(); ready = false;
      frame = canvasFrame(doc, next, 'Slide preview');
      viewport.append(frame);
      place();
    },
    // Before the frame first reports, Play waits for it.
    play() { if (ready) frame.contentWindow.postMessage({ type: 'storybench-canvas-play' }, '*'); else wantsPlay = true; },
    destroy() { doc.defaultView.removeEventListener('message', receive); observer.disconnect(); frame?.remove(); frame = null; url = null; },
  };
}

// `inspectorHost` places the inspector outside the canvas (the slide editor's Elements panel).
// `onChange` saves; a text commit reads its promise, false when the save was refused. `onReload`
// replaces the production with the latest saved revision, for retrying a refused text commit.
// `getItems` is the production's library (the visual's toolbar names the asset in use); `onOpenAsset(id)`
// opens its asset preview.
export function createDeckCanvas(section, { channel = () => null, onChange = () => {}, onReload = async () => {}, inspectorHost = null, getItems = () => null, onOpenAsset = () => {} } = {}) {
  const doc = section.ownerDocument;
  section.innerHTML = `<div class="deck-canvas-body"><div class="deck-canvas-surface" tabindex="-1" aria-label="Slide canvas" data-canvas-surface><div class="deck-canvas-viewport"></div><div class="deck-canvas-blocks"></div></div></div>
    <div class="deck-canvas-bar"><button type="button" class="primary" data-canvas-play>Play slide</button><div class="deck-canvas-stages" data-canvas-stages></div></div>
    <p class="deck-canvas-status" role="status" data-canvas-status></p>`;
  const stagesBar = section.querySelector('[data-canvas-stages]'), playButton = section.querySelector('[data-canvas-play]');
  const surfaceRoot = section.querySelector('[data-canvas-surface]'), viewport = section.querySelector('.deck-canvas-viewport');
  const blocksLayer = section.querySelector('.deck-canvas-blocks'), status = section.querySelector('[data-canvas-status]');
  const inspector = createInspectorPanel({ emptyTitle: 'Slide and deck', doc });
  (inspectorHost || section.querySelector('.deck-canvas-body')).append(inspector.element);
  // The selection toolbar sits over the canvas, after the surface in tab order.
  const toolbar = Object.assign(doc.createElement('div'), { className: 'deck-canvas-toolbar', hidden: true });
  toolbar.setAttribute('role', 'toolbar');
  section.querySelector('.deck-canvas-body').append(toolbar);

  let episode = null, slideId = null, stage = null, scope = 'slide', selected = null, playing = false;
  let standards = null, fonts = [], standardsFor = null, frame = null, pending = null, info = null, shown = '', drawn = '', replay = null;
  // The open text edit ({field, text}: text is what a click-off would save, or null), and a refused commit kept for retry.
  let editing = null, kept = null;
  const slide = () => episode?.cards.find((item) => item.id === slideId) || null;
  const design = () => (episode.design ||= { theme: { colors: {}, fonts: {}, setBy: { colors: {}, fonts: {} } } });

  const surface = createSelectionSurface(surfaceRoot, { onChange(key) { selected = key; renderInspector(); } });
  playButton.addEventListener('click', () => frame?.contentWindow.postMessage({ type: 'storybench-canvas-play' }, '*'));

  // ---- Frame: the saved slide as the build renders it. A new frame replaces the old once it reports.
  const frameUrl = () => slide() ? slideFrameUrl(episode, slideId, standards?.revision ?? 0) : null;
  async function load() {
    const url = frameUrl();
    // A new revision waits for the open text edit; the edit's commit then saves over it.
    if (!url || url === shown || editing) return;
    shown = url;
    const refusal = await canvasRefusal(url, channel());
    if (shown !== url) return;
    status.textContent = refusal || '';
    if (refusal) return;
    pending?.remove();
    pending = canvasFrame(doc, `${url}&${new URLSearchParams({ ...(stage === null ? {} : { stage }), scroll: Math.round(info?.scroll?.top || 0) })}`, 'Slide as built');
    Object.assign(pending.dataset, { slideId, revision: episode.revision });
    viewport.append(pending);
    place();
  }
  function receive(event) {
    const data = event.data;
    if (data?.type === 'storybench-canvas-text' && data.version === 1 && frame && event.source === frame.contentWindow) return textEvent(data);
    if (!data || data.type !== 'storybench-canvas' || data.version !== 1) return;
    if (pending && event.source === pending.contentWindow) {
      frame?.remove(); frame = pending; pending = null; frame.classList.remove('is-loading');
      // A step whose timing just changed replays once a revision saved after the change shows.
      if (replay && Number(frame.dataset.revision) > replay.after) { frame.contentWindow.postMessage({ type: 'storybench-canvas-play-step', stage: replay.stage }, '*'); replay = null; }
    } else if (!frame || event.source !== frame.contentWindow) return;
    const before = info && Object.keys(info.blocks).join();
    info = data;
    // While Play runs, the step bar follows the frame; when it ends the frame holds the full reveal.
    if (data.playing || playing) { playing = Boolean(data.playing); stage = data.stage; }
    // A stage the slide no longer has is the full reveal, as the bridge shows it; ask again only for a stage it has not applied yet.
    if (stage !== null && !(stage < data.stages)) stage = null;
    if (!playing && stage !== null && data.stage !== stage) return frame.contentWindow.postMessage({ type: 'storybench-canvas-show', stage }, '*');
    place(); renderStages();
    if (before !== Object.keys(info.blocks).join()) { surface.refresh(); renderInspector(); }
  }
  doc.defaultView.addEventListener('message', receive);

  // ---- Geometry: the frame is scaled to the canvas width and cropped to the slide area.
  function place() {
    const area = info?.area || AREA;
    surfaceRoot.style.maxWidth = `${area.width + 2}px`;
    const scale = Math.min(1, (viewport.clientWidth || area.width) / area.width);
    viewport.style.height = `${Math.round(area.height * scale)}px`;
    for (const item of [frame, pending]) if (item) item.style.transform = `translate(${-area.left * scale}px, ${-area.top * scale}px) scale(${scale})`;
    const key = JSON.stringify([info?.blocks, area, scale]);
    if (key === drawn) return;
    drawn = key;
    // A block keeps its element, in place, across redraws: a click or keyboard focus on it survives the frame re-reporting.
    const blocks = Object.entries(info?.blocks || {});
    for (const block of [...blocksLayer.children]) if (!info?.blocks?.[block.dataset.select]) block.remove();
    blocks.forEach(([name, box], i) => {
      let block = [...blocksLayer.children].find((node) => node.dataset.select === name);
      if (!block) {
        block = doc.createElement('div');
        block.className = 'deck-canvas-block';
        block.dataset.select = name; block.dataset.selectLabel = BLOCKS[name];
      }
      if (blocksLayer.children[i] !== block) blocksLayer.insertBefore(block, blocksLayer.children[i] || null);
      Object.assign(block.style, { left: `${(box.left - area.left) * scale}px`, top: `${(box.top - area.top) * scale}px`, width: `${box.width * scale}px`, height: `${box.height * scale}px` });
    });
    surface.refresh();
    placeToolbar();
  }
  new ResizeObserver(() => { drawn = ''; place(); }).observe(viewport);
  // The frame is inert: wheel over the canvas scrolls a tall slide, and a block taking keyboard focus is scrolled into view.
  surfaceRoot.addEventListener('wheel', (event) => {
    const scroll = info?.scroll;
    if (!frame || event.ctrlKey || !scroll || (event.deltaY > 0 ? scroll.top >= scroll.max : scroll.top <= 0)) return;
    event.preventDefault();
    const scale = viewport.clientWidth / (info?.area || AREA).width;
    frame.contentWindow.postMessage({ type: 'storybench-canvas-scroll', by: (event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY) / Math.min(1, scale) }, '*');
  }, { passive: false });
  surfaceRoot.addEventListener('focusin', (event) => {
    const block = event.target.dataset?.select;
    if (block && frame) frame.contentWindow.postMessage({ type: 'storybench-canvas-reveal', block }, '*');
  });

  // ---- Text on the slide. A double-click makes the frame live and asks it for the text at that point;
  // the frame reports the edit's start, each change, and its end (with the text to save, or null).
  surfaceRoot.addEventListener('dblclick', (event) => {
    if (!frame || pending || playing || editing) return;
    const area = info?.area || AREA, box = viewport.getBoundingClientRect(), scale = Math.min(1, box.width / area.width);
    live(true);
    frame.focus();
    frame.contentWindow.postMessage({ type: 'storybench-canvas-edit', x: (event.clientX - box.left) / scale + area.left, y: (event.clientY - box.top) / scale + area.top }, '*');
  });
  function live(on) {
    frame.inert = !on;
    if (on) frame.removeAttribute('aria-hidden'); else frame.setAttribute('aria-hidden', 'true');
    surfaceRoot.classList.toggle('is-editing', on);
  }
  function textEvent({ phase, field, text }) {
    if (phase === 'start') { editing = { field, text: null }; kept = null; status.textContent = ''; return; }
    if (phase === 'input' && editing) { editing.text = text; return; }
    if (phase !== 'end' && phase !== 'none') return;
    const done = editing;
    editing = null;
    live(false);
    // Escape or Enter leaves focus in the frame: it returns to the selection. A click elsewhere keeps its focus.
    if (doc.activeElement === frame) (blocksLayer.querySelector(`[data-select="${CSS.escape(selected || '')}"]`) || surfaceRoot).focus({ preventScroll: true });
    if (done && text !== null) commitText(done.field, text);
    load();
  }
  // A commit writes the field and saves once; a refused save keeps the text, with Reload and retry.
  async function commitText(field, text) {
    const [key, part] = field.name.split('.'), owner = part ? slide()?.[key]?.[field.index] : slide();
    if (!owner) return keep(field, text, 'This text is no longer on the slide, so it was not saved.');
    owner[part || key] = text;
    renderInspector();
    if (await onChange() === false) keep(field, text, 'Your text was not saved.');
  }
  function keep(field, text, message) {
    kept = { slideId, field, text };
    const retry = Object.assign(doc.createElement('button'), { type: 'button', className: 'deck-canvas-retry', textContent: 'Reload and retry' });
    retry.addEventListener('click', async () => {
      const held = kept;
      if (!held) return;
      kept = null; status.textContent = 'Reloading…';
      await onReload();
      if (slideId !== held.slideId) return;
      status.textContent = '';
      commitText(held.field, held.text);
    });
    status.replaceChildren(`${message} It is kept: “${text}”. `, retry);
  }
  // Closing the editor or moving to another slide commits an open edit as a click-off would.
  function finishEdit() {
    if (!editing) return;
    const { field, text } = editing;
    editing = null;
    if (frame) live(false);
    if (text !== null) commitText(field, text);
  }

  // ---- Step bar: Start (the slide as it opens), each later stage, and All (the full reveal, the default).
  // Choosing one holds the slide there and stops Play; during Play it follows, and the stage Play is
  // about to click pulses.
  let stepper = null;
  function renderStages() {
    const count = info?.stages ?? 0, key = `${count}`;
    if (count < 2) { stagesBar.replaceChildren(); stepper = null; return; }
    if (stepper?.key !== key) {
      const choice = createSegmentedChoice({ label: 'Show step', doc, value: stage ?? 'all',
        options: [...Array.from({ length: count }, (_, i) => ({ value: i, label: i ? `${i}` : 'Start' })), { value: 'all', label: 'All' }],
        onChange(value) { stage = value === 'all' ? null : value; playing = false; frame?.contentWindow.postMessage({ type: 'storybench-canvas-show', stage }, '*'); } });
      const label = doc.createElement('span'); label.textContent = 'Showing';
      stagesBar.replaceChildren(label, choice.element);
      stepper = { key, choice };
    }
    stepper.choice.value = stage ?? 'all';
    const pulse = playing ? info?.pulse : null;
    stepper.choice.element.querySelectorAll('button').forEach((button, i) => button.classList.toggle('is-pulsing', i === pulse));
    playButton.setAttribute('aria-pressed', String(playing));
  }

  // ---- Values: in This slide scope the effective value (slide, else deck); in All slides the deck default.
  const deckValue = (primitive, arg) => design()[primitive]?.[arg] ?? null;
  const value = (primitive, arg) => (scope === 'slide' ? slide()?.design?.[primitive]?.[arg] : null) ?? deckValue(primitive, arg);
  // Sets arguments of one primitive in the current scope; null unsets one.
  function set(primitive, args) {
    const target = scope === 'deck' ? design() : (slide().design ||= {});
    for (const [arg, next] of Object.entries(args)) {
      if (next == null) delete target[primitive]?.[arg];
      else (target[primitive] ||= {})[arg] = next;
    }
    if (target[primitive] && !Object.keys(target[primitive]).length) delete target[primitive];
    if (scope === 'slide' && !Object.keys(target).length) delete slide().design;
    changed();
  }
  // A slide override is marked when it differs from the deck default.
  const overridden = (primitives) => primitives.some((primitive) => Object.entries(slide()?.design?.[primitive] || {}).some(([arg, item]) => item !== deckValue(primitive, arg)));
  function resetSlide(primitives) {
    const own = slide()?.design;
    if (!own) return;
    for (const primitive of primitives) delete own[primitive];
    if (!Object.keys(own).length) delete slide().design;
    changed();
  }
  function changed() { renderInspector(); onChange(); }

  // ---- Inspector: the selected block's arguments, or slide-wide primitives and the deck theme.
  const field = (key, caption, control) => {
    const wrap = doc.createElement('div');
    wrap.className = 'deck-canvas-field'; wrap.dataset.control = key;
    // A control with its own visible label (duration field) takes no caption.
    if (caption) wrap.append(Object.assign(doc.createElement('span'), { className: 'deck-canvas-label', textContent: caption }));
    wrap.append(control.element || control);
    return wrap;
  };
  const note = (text) => Object.assign(doc.createElement('p'), { className: 'deck-canvas-note', textContent: text });
  const segmented = (primitive, arg, caption, options) => field(`${primitive}.${arg}`, caption, createSegmentedChoice({ label: caption, doc, value: value(primitive, arg),
    options: options.map(([item, label]) => ({ value: item, label })), onChange: (next) => set(primitive, { [arg]: next }) }));
const SIDE_NAMES = { top: 'Above visual', bottom: 'Below visual', left: 'Left of visual', right: 'Right of visual' };
  // Position and Alignment are dropdowns whose menus hold the picker and the 3 x 3 grid; choosing sets it and closes.
  function dropdown(key, caption, text, control) {
    const wrap = Object.assign(doc.createElement('div'), { className: 'deck-canvas-dropdown' });
    const button = Object.assign(doc.createElement('button'), { type: 'button', className: 'deck-canvas-dropdown-button', textContent: `${text} ▾` });
    button.setAttribute('aria-haspopup', 'true'); button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', `${caption}: ${text}`);
    const menu = Object.assign(doc.createElement('div'), { className: 'deck-canvas-menu', hidden: true });
    menu.dataset.canvasMenu = '';
    menu.append(control.element);
    button.addEventListener('click', () => {
      if (!menu.hidden) return closeMenu();
      closeMenu(); menu.hidden = false; button.setAttribute('aria-expanded', 'true'); control.focus();
    });
    wrap.append(button, menu);
    return field(key, caption, wrap);
  }
  function position(primitive, caption) {
    const side = value(primitive, 'position');
    return dropdown(`${primitive}.position`, caption, SIDE_NAMES[side] || 'Template', createPositionPicker({ label: caption, doc, value: side,
      onChange: (next) => { closeMenu(); set(primitive, { position: next }); } }));
  }
  function alignment(primitive) {
    const align = value(primitive, 'align'), valign = value(primitive, 'valign');
    // One argument set alone shows beside the other's template value (left, middle).
    const shown = align || valign ? { align: align || 'start', valign: valign || 'center' } : null;
    return dropdown(`${primitive}.align`, 'Alignment', alignName(shown), createAlignmentGrid({ label: `${BLOCKS[primitive]} alignment`, doc, value: shown,
      onChange: (next) => { closeMenu(); set(primitive, next); } }));
  }
  // Closes an open toolbar menu, returning focus to its button; false when none was open.
  function closeMenu() {
    const menu = section.querySelector('[data-canvas-menu]:not([hidden])');
    if (!menu) return false;
    menu.hidden = true;
    const button = menu.previousElementSibling;
    button.setAttribute('aria-expanded', 'false');
    if (menu.contains(doc.activeElement)) button.focus();
    return true;
  }
  doc.addEventListener('pointerdown', (event) => { if (!event.target.closest?.('.deck-canvas-dropdown')) closeMenu(); });
  function scopeSwitch(primitives) {
    return field('scope', 'Apply to', createScopeSwitch({ doc, value: scope, overridden: overridden(primitives),
      onChange(next) { scope = next; renderInspector(); }, onReset: () => resetSlide(primitives) }));
  }
  // The visual's toolbar: the candidate in use and Open asset.
  function visualView() {
    const own = slide(), id = own?.vector?.itemId || own?.media?.itemId || own?.subnav?.find((view) => view.itemId)?.itemId;
    const item = id && (getItems() || []).find((entry) => entry.id === id);
    const text = Object.assign(doc.createElement('span'), { className: 'deck-canvas-in-use', textContent: item ? `In use: ${item.label} v${item.iteration ?? 1}` : 'No pick' });
    const parts = [field('inUse', null, text)];
    if (item) {
      const open = Object.assign(doc.createElement('button'), { type: 'button', textContent: 'Open asset' });
      open.addEventListener('click', () => onOpenAsset(item.id));
      parts.push(field('openAsset', null, open));
    }
    return parts;
  }
  // The toolbar's controls for the selected block: copy has Position, Alignment and Size; stage text has
  // Style, Position and Align; the visual has the candidate in use and Open asset. Each has the scope.
  function blockView(key) {
    // The visual's toolbar edits no deck value, so it has no scope.
    if (key === 'visual') return visualView();
    const visual = Boolean(info?.blocks.visual), parts = [scopeSwitch(VIEW_PRIMITIVES[key])];
    if (key === 'stageText') {
      parts.push(segmented('stageText', 'style', 'Style', STYLES));
      const style = value('stageText', 'style');
      if (['list', 'card'].includes(style)) parts.push(segmented('stageText', 'numbered', 'Numbers', [[true, 'Numbered'], [false, 'Plain']]));
      if (style === 'card') parts.push(field('stageText.flipMs', null, createDurationField({ label: 'Flip time', min: 0, max: 2000, defaultLabel: 'Standard', doc,
        value: value('stageText', 'flipMs'), onChange: (next) => set('stageText', { flipMs: next }) })));
    }
    if (visual || scope === 'deck') parts.push(position(key, 'Position'));
    else parts.push(note('Add media, a vector or a gallery to place this beside a visual.'));
    parts.push(alignment(key));
    if (key === 'copy') parts.push(segmented('type', 'scale', 'Size', SCALES));
    return parts;
  }
  function slideView() {
    return [scopeSwitch(VIEW_PRIMITIVES['']),
      segmented('type', 'scale', 'Type size', SCALES), segmented('spacing', 'density', 'Spacing', DENSITIES),
      field('timing.betweenMs', null, createDurationField({ label: 'Gap between stages', min: 0, max: 60000, defaultLabel: 'Per stage', doc,
        value: value('timing', 'betweenMs'), onChange: (next) => set('timing', { betweenMs: next }) })),
      themeView()];
  }
  // The deck theme: deck level only. Inherited roles show the channel's value, marked; a change makes it this deck's own.
  function source(kind, role) {
    if (design().theme?.[kind]?.[role] != null) return { value: design().theme[kind][role], own: true, text: design().theme.setBy?.[kind]?.[role] === 'agent' ? 'Chosen for this deck by the agent' : 'This deck' };
    const channelValue = standards?.[kind === 'colors' ? 'colorRoles' : 'fontRoles']?.[role];
    if (channelValue != null) return { value: channelValue, own: false, text: 'From Brand Standards' };
    return { value: kind === 'colors' ? standards?.deckTemplate?.colorRoles[role] : standards?.deckTemplate?.font, own: false, text: 'Not set: the agent may choose' };
  }
  function setTheme(kind, role, next) {
    const theme = (design().theme ||= { colors: {}, fonts: {}, setBy: { colors: {}, fonts: {} } });
    if (next == null) { delete theme[kind]?.[role]; delete theme.setBy?.[kind]?.[role]; }
    else (theme[kind] ||= {})[role] = next;
    changed();
  }
  function themeRow(kind, role, caption, control) {
    const from = source(kind, role), row = field(`theme.${kind}.${role}`, caption, control);
    const marker = doc.createElement('span');
    marker.className = 'deck-canvas-source'; marker.textContent = from.text;
    row.append(marker);
    if (from.own) {
      const reset = Object.assign(doc.createElement('button'), { type: 'button', className: 'deck-canvas-reset', textContent: 'Use Brand Standards' });
      reset.setAttribute('aria-label', `${caption}: use Brand Standards`);
      reset.addEventListener('click', () => setTheme(kind, role, null));
      row.append(reset);
    }
    return row;
  }
  function themeView() {
    const box = doc.createElement('section');
    box.className = 'deck-canvas-theme';
    const heading = Object.assign(doc.createElement('h3'), { textContent: 'Deck colors and fonts' });
    box.append(heading, note('For this deck only; the channel’s Brand Standards stay as they are.'));
    for (const [role, caption] of COLOR_ROLES) {
      const { value: color } = source('colors', role), trigger = doc.createElement('button');
      trigger.type = 'button'; trigger.className = 'deck-canvas-swatch';
      trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-label', `${caption}: ${color || 'not set'}`);
      trigger.innerHTML = '<span></span>';
      trigger.firstChild.style.background = color || 'transparent';
      trigger.append(color || '');
      trigger.addEventListener('click', () => openColorPicker({ trigger, value: color || '', onPick: (next) => setTheme('colors', role, next) }));
      box.append(themeRow('colors', role, caption, trigger));
    }
    for (const [role, caption] of FONT_ROLES) {
      const { value: family } = source('fonts', role), select = doc.createElement('select');
      select.setAttribute('aria-label', caption); select.dataset.font = role;
      // The template's own face (Manrope) is not in the catalogue: it shows as the unset choice.
      if (!fonts.some((font) => font.family === family)) select.append(new Option(`${family || 'Template font'} (template)`, '', false, true));
      for (const font of fonts.filter((item) => item.available || item.family === family)) {
        const option = new Option(font.family, font.family, false, font.family === family);
        option.style.fontFamily = `"${font.family}"`;
        select.append(option);
      }
      select.addEventListener('change', () => setTheme('fonts', role, select.value || null));
      box.append(themeRow('fonts', role, caption, select));
    }
    return box;
  }
  let inspected = '';
  function renderInspector(force = true) {
    if (!episode || !slide()) return;
    const key = JSON.stringify([selected, scope, slide().design, slide().stages?.length, slide().vector, slide().media, slide().subnav, design(), Object.keys(info?.blocks || {}), standards?.revision, fonts.length]);
    if (!force && key === inspected) return;
    inspected = key;
    // Keep keyboard focus on the same control across a re-render.
    const active = [inspector.element, toolbar].find((host) => host.contains(doc.activeElement));
    const control = active && doc.activeElement.closest('[data-control]')?.dataset.control;
    inspector.show({ title: 'Slide and deck', content: slideView() });
    toolbar.hidden = !selected;
    if (selected) {
      const label = Object.assign(doc.createElement('strong'), { className: 'deck-canvas-toolbar-label', textContent: BLOCKS[selected] });
      toolbar.setAttribute('aria-label', `${BLOCKS[selected]} controls`);
      toolbar.dataset.toolbarBlock = selected;
      toolbar.replaceChildren(label, ...blockView(selected));
      placeToolbar();
    } else toolbar.replaceChildren();
    if (!control) return;
    const host = active.querySelector(`[data-control="${CSS.escape(control)}"]`);
    (host?.querySelector('[aria-pressed="true"], [aria-checked="true"], input, button, [tabindex="0"]') || host)?.focus?.();
  }
  // Above the selected block, or below it (over the step bar if need be) when there is no room above;
  // kept inside the canvas width.
  // "Room" also means not covering another selectable block, so the creator can still click it; when
  // both sides would, the side covering less wins.
  function placeToolbar() {
    const block = selected && blocksLayer.querySelector(`[data-select="${selected}"]`);
    if (toolbar.hidden || !block) return;
    const host = toolbar.offsetParent?.getBoundingClientRect(), box = block.getBoundingClientRect();
    if (!host) return;
    const width = toolbar.offsetWidth, height = toolbar.offsetHeight;
    const left = Math.max(0, Math.min(box.left - host.left, host.width - width));
    const others = [...blocksLayer.querySelectorAll('[data-select]')].filter((node) => node !== block).map((node) => node.getBoundingClientRect());
    const covered = (top) => others.reduce((sum, rect) => sum
      + Math.max(0, Math.min(rect.right, host.left + left + width) - Math.max(rect.left, host.left + left))
      * Math.max(0, Math.min(rect.bottom, host.top + top + height) - Math.max(rect.top, host.top + top)), 0);
    const sides = [['above', box.top - host.top - height - 8], ['below', box.bottom - host.top + 8]]
      .map(([side, top]) => ({ side, top, fits: top >= 0, cover: covered(top) }));
    const [best] = [...sides].sort((a, b) => (b.fits - a.fits) || (a.cover - b.cover));
    const chosen = sides[0].fits && !sides[0].cover ? sides[0] : best;
    toolbar.dataset.side = chosen.side;
    toolbar.style.top = `${chosen.top}px`;
    toolbar.style.left = `${left}px`;
  }

  // ---- Drag to snap: a selected copy or stage text block on a slide with a visual drags onto one of the
  // drop zones around the visual (Left, Right, Above, Below); dropping sets that block's bounded position
  // in the current scope. A press without movement stays a click.
  let drag = null, swallowClick = false;
  const zones = () => [...blocksLayer.querySelectorAll('[data-zone]')];
  const zoneAt = (x, y) => zones().find((zone) => { const box = zone.getBoundingClientRect(); return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom; }) || null;
  function showZones() {
    const visual = blocksLayer.querySelector('[data-select="visual"]');
    if (!visual) return;
    const [x, y, w, h] = ['left', 'top', 'width', 'height'].map((name) => parseFloat(visual.style[name]));
    for (const [side, label, [l, t, zw, zh]] of ZONES) {
      const zone = Object.assign(doc.createElement('div'), { className: 'deck-canvas-zone', textContent: label });
      zone.dataset.zone = side;
      Object.assign(zone.style, { left: `${x + l * w}px`, top: `${y + t * h}px`, width: `${zw * w}px`, height: `${zh * h}px` });
      blocksLayer.append(zone);
    }
  }
  function endDrag() {
    if (!drag) return;
    drag.block.style.transform = '';
    zones().forEach((zone) => zone.remove());
    surfaceRoot.classList.remove('is-dragging');
    drag = null;
  }
  blocksLayer.addEventListener('pointerdown', (event) => {
    const block = event.target.closest('.deck-canvas-block'), key = block?.dataset.select;
    if (event.button !== 0 || !block || key !== selected || !['copy', 'stageText'].includes(key) || !info?.blocks.visual) return;
    event.preventDefault();
    drag = { key, block, x: event.clientX, y: event.clientY, moved: false };
  });
  doc.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) { drag.moved = true; surfaceRoot.classList.add('is-dragging'); showZones(); }
    drag.block.style.transform = `translate(${dx}px, ${dy}px)`;
    const over = zoneAt(event.clientX, event.clientY);
    zones().forEach((zone) => zone.classList.toggle('is-over', zone === over));
  });
  doc.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const { key, moved } = drag, zone = moved ? zoneAt(event.clientX, event.clientY) : null;
    endDrag();
    if (!moved) return;
    // The click that ends a drag is not a selection change.
    swallowClick = true; setTimeout(() => { swallowClick = false; });
    if (zone && value(key, 'position') !== zone.dataset.zone) set(key, { position: zone.dataset.zone });
  });
  doc.addEventListener('pointercancel', endDrag);
  surfaceRoot.addEventListener('click', (event) => { if (swallowClick) { swallowClick = false; event.stopImmediatePropagation(); } }, true);

  // ---- Data the theme needs: the channel's standards (with the template's own roles) and the font catalogue.
  async function loadStandards() {
    const id = channel() || '';
    if (standardsFor === id) return;
    standardsFor = id;
    const headers = id ? { 'x-storybench-channel': id } : {};
    const [value, catalogue] = await Promise.all(['/api/brand-standards', '/api/fonts'].map((url) => fetch(url, { headers }).then((r) => r.ok ? r.json() : null).catch(() => null)));
    standards = value; fonts = catalogue || [];
    for (const font of fonts.filter((item) => item.available)) for (const [weight, file] of [[400, 'regular'], [700, 'bold']]) {
      if (![...doc.fonts].some((face) => face.family === font.family && face.weight === String(weight))) doc.fonts.add(new FontFace(font.family, `url("${font.urls[file]}")`, { weight: String(weight) }));
    }
    shown = ''; load(); renderInspector();
  }

  function open(id) {
    if (id === slideId || !episode?.cards.some((item) => item.id === id)) return;
    finishEdit(); kept = null; status.textContent = '';
    slideId = id; stage = null; selected = null; info = null; drawn = ''; playing = false; replay = null;
    surface.select(null); blocksLayer.replaceChildren(); renderStages();
    load(); renderInspector();
  }
  return {
    // The production as the editor now holds it; a new revision reloads the frame.
    // The editor opens a slide with show(episode) then open(slideId).
    show(next) {
      if (episode?.id !== next.id) { slideId = null; standardsFor = null; scope = 'slide'; }
      episode = next;
      loadStandards();
      if (!slide()) return;
      load(); renderInspector(false);
    },
    open,
    // Play step replays one step from its start state; replayStep does so once a revision saved after
    // the change shows (a refused save shows none; the next slide or close drops it).
    playStep(index) { frame?.contentWindow.postMessage({ type: 'storybench-canvas-play-step', stage: index }, '*'); },
    replayStep(index) { if (episode) replay = { stage: index, after: episode.revision }; },
    closeMenu,
    // Closing the editor drops the frame, so a hidden canvas loads and plays nothing.
    hide() {
      finishEdit(); kept = null; status.textContent = '';
      endDrag(); closeMenu(); replay = null;
      episode = null; slideId = null; shown = ''; info = null; drawn = ''; playing = false;
      frame?.remove(); pending?.remove(); frame = pending = null;
      surface.select(null); blocksLayer.replaceChildren(); renderStages();
    },
    // What the frame shows now, for Markup (spec #46 'Redlines'): its slide and saved revision, the step
    // (null is All) and scroll. Null until the open slide's frame has reported.
    get shown() {
      if (!frame || !info || frame.dataset.slideId !== slideId) return null;
      return { slideId, revision: Number(frame.dataset.revision), stage, scroll: Math.round(info.scroll?.top || 0) };
    },
    // Escape steps back through the selection before it closes the editor.
    get selected() { return selected; },
    deselect() { surface.select(null); },
    get slideId() { return slideId; },
  };
}
