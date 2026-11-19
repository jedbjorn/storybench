// Slides canvas (spec #44, Editing by selection). The open slide is shown exactly as the build renders
// it: an inert, sandboxed frame of the saved slide built by the deck template (server route
// deck-canvas), held at a stage by its bridge script. Selection is drawn over the frame from the block
// boxes the bridge reports, using the shared UI primitives; changes edit the deck design or the slide's
// overrides and are saved through the normal save, after which the frame shows the new revision.
// The slide editor (spec #46) hosts this canvas: Play slide runs the slide's timeline in the frame and
// the step bar (Start, 1 … n−1, All) follows it.
import { createSelectionSurface } from './ui/selection-surface.js';
import { createInspectorPanel } from './ui/inspector-panel.js';
import { createSegmentedChoice } from './ui/segmented-choice.js';
import { createPositionPicker } from './ui/position-picker.js';
import { createAlignmentGrid } from './ui/alignment-grid.js';
import { createDurationField } from './ui/duration-field.js';
import { createScopeSwitch } from './ui/scope-switch.js';
import { openColorPicker } from './color-picker.js';

const BLOCKS = { copy: 'Title and text', stageText: 'Stage text', visual: 'Visual' };
// The primitives each inspector view edits; '' is the view with nothing selected.
const VIEW_PRIMITIVES = { copy: ['copy'], stageText: ['stageText'], visual: ['copy', 'stageText'], '': ['type', 'spacing', 'timing'] };
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
export function createDeckCanvas(section, { channel = () => null, onChange = () => {}, inspectorHost = null } = {}) {
  const doc = section.ownerDocument;
  section.innerHTML = `<div class="deck-canvas-body"><div class="deck-canvas-surface" tabindex="-1" aria-label="Slide canvas" data-canvas-surface><div class="deck-canvas-viewport"></div><div class="deck-canvas-blocks"></div></div></div>
    <div class="deck-canvas-bar"><button type="button" class="primary" data-canvas-play>Play slide</button><div class="deck-canvas-stages" data-canvas-stages></div></div>
    <p class="deck-canvas-status" role="status" data-canvas-status></p>`;
  const stagesBar = section.querySelector('[data-canvas-stages]'), playButton = section.querySelector('[data-canvas-play]');
  const surfaceRoot = section.querySelector('[data-canvas-surface]'), viewport = section.querySelector('.deck-canvas-viewport');
  const blocksLayer = section.querySelector('.deck-canvas-blocks'), status = section.querySelector('[data-canvas-status]');
  const inspector = createInspectorPanel({ emptyTitle: 'Slide and deck', doc });
  (inspectorHost || section.querySelector('.deck-canvas-body')).append(inspector.element);

  let episode = null, slideId = null, stage = null, scope = 'slide', selected = null, playing = false;
  let standards = null, fonts = [], standardsFor = null, frame = null, pending = null, info = null, shown = '', drawn = '';
  const slide = () => episode?.cards.find((item) => item.id === slideId) || null;
  const design = () => (episode.design ||= { theme: { colors: {}, fonts: {}, setBy: { colors: {}, fonts: {} } } });

  const surface = createSelectionSurface(surfaceRoot, { onChange(key) { selected = key; renderInspector(); } });
  playButton.addEventListener('click', () => frame?.contentWindow.postMessage({ type: 'storybench-canvas-play' }, '*'));

  // ---- Frame: the saved slide as the build renders it. A new frame replaces the old once it reports.
  const frameUrl = () => slide() ? slideFrameUrl(episode, slideId, standards?.revision ?? 0) : null;
  async function load() {
    const url = frameUrl();
    if (!url || url === shown) return;
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
    if (!data || data.type !== 'storybench-canvas' || data.version !== 1) return;
    if (pending && event.source === pending.contentWindow) {
      frame?.remove(); frame = pending; pending = null; frame.classList.remove('is-loading');
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
  const position = (primitive, caption) => field(`${primitive}.position`, caption, createPositionPicker({ label: caption, doc, value: value(primitive, 'position'), onChange: (next) => set(primitive, { position: next }) }));
  function alignment(primitive) {
    const align = value(primitive, 'align'), valign = value(primitive, 'valign');
    // One argument set alone shows beside the other's template value (left, middle).
    const shown = align || valign ? { align: align || 'start', valign: valign || 'center' } : null;
    return field(`${primitive}.align`, 'Alignment', createAlignmentGrid({ label: `${BLOCKS[primitive]} alignment`, doc, value: shown,
      onChange: (next) => set(primitive, next) }));
  }
  function scopeSwitch(primitives) {
    return field('scope', 'Apply to', createScopeSwitch({ doc, value: scope, overridden: overridden(primitives),
      onChange(next) { scope = next; renderInspector(); }, onReset: () => resetSlide(primitives) }));
  }
  function blockView(key) {
    const visual = Boolean(info?.blocks.visual), parts = [scopeSwitch(VIEW_PRIMITIVES[key])];
    if (key === 'visual') {
      parts.push(position('copy', 'Title and text'));
      if (slide()?.stages?.length) parts.push(position('stageText', 'Stage text'));
      return parts;
    }
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
    const key = JSON.stringify([selected, scope, slide().design, slide().stages?.length, design(), Object.keys(info?.blocks || {}), standards?.revision, fonts.length]);
    if (!force && key === inspected) return;
    inspected = key;
    // Keep keyboard focus on the same control across a re-render.
    const active = inspector.element.contains(doc.activeElement) ? doc.activeElement.closest('[data-control]')?.dataset.control : null;
    inspector.show(selected ? { title: BLOCKS[selected], content: blockView(selected) } : { title: 'Slide and deck', content: slideView() });
    if (!active) return;
    const host = inspector.element.querySelector(`[data-control="${CSS.escape(active)}"]`);
    (host?.querySelector('[aria-pressed="true"], [aria-checked="true"], input, button, [tabindex="0"]') || host)?.focus?.();
  }

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
    slideId = id; stage = null; selected = null; info = null; drawn = ''; playing = false;
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
    // Closing the editor drops the frame, so a hidden canvas loads and plays nothing.
    hide() {
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
