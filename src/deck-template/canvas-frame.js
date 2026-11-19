// Slides canvas bridge (spec #44, Editing by selection). Served only with the canvas build of one
// slide, never in a bundle. It holds the slide still at a stage (default: full reveal) and reports
// where its selectable blocks are, so the editor can draw selection over the frame without reaching
// into it. The frame keeps the bundle's sandbox: everything crosses by postMessage.
// Play (spec #46, Slide Editor: Play) runs the slide's own timeline from Start; an On click stage is
// clicked after a short pause, and the slide ends held at the full reveal.
(() => {
  'use strict';
  const deck = window.storybenchDeck, slide = document.querySelector('.slide');
  const presentation = document.getElementById('presentation');
  if (!deck || !slide || window.parent === window) return;
  const BLOCKS = { copy: '.copy', stageText: '.stage-text', visual: '.visual' };
  let stage = null, playing = null;
  // How long Play waits before clicking an On click stage, as a person would.
  const CLICK_PAUSE_MS = 700;
  // The boxes an element draws. A display:contents wrapper (an unplaced block) draws its children's.
  function boxes(element) {
    if (!element || element.hidden) return [];
    const style = getComputedStyle(element);
    if (style.display === 'none') return [];
    if (style.display === 'contents') return [...element.children].flatMap(boxes);
    const box = element.getBoundingClientRect();
    return box.width && box.height ? [box] : [];
  }
  function union(rects) {
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top));
    return { left, top, width: Math.max(...rects.map((r) => r.right)) - left, height: Math.max(...rects.map((r) => r.bottom)) - top };
  }
  function post() {
    const area = presentation.getBoundingClientRect(), blocks = {};
    for (const [key, selector] of Object.entries(BLOCKS)) {
      const box = union(boxes(slide.querySelector(selector)));
      if (box) blocks[key] = box;
    }
    window.parent.postMessage({ type: 'storybench-canvas', version: 1, slideId: slide.id, stage,
      playing: Boolean(playing), pulse: playing?.pulse ?? null, stages: deck.timeline().stages.length, area: { left: area.left, top: area.top, width: area.width, height: area.height }, blocks,
      scroll: { top: presentation.scrollTop, max: presentation.scrollHeight - presentation.clientHeight } }, '*');
  }
  // A stage is shown at the end of its own motion, before the next stage begins; null is the full reveal.
  // Any stage index the slide has is kept as asked (the editor normalizes by the same rule), the last included.
  function show(value) {
    stop();
    const { stages, durationMs } = deck.timeline();
    stage = Number.isInteger(value) && value >= 0 && value < stages.length ? value : null;
    const time = stage === null ? durationMs : Math.max(stages[stage].startMs, Math.min(stages[stage].motionEndMs, (stages[stage + 1]?.startMs ?? Infinity) - 0.5));
    deck.seek(time);
    post();
  }
  // Play: the runtime's own clock runs the slide. Each tick reports the stage it reached; where the
  // timeline waits for a person, the next stage's control is clicked (pulse names it for the editor).
  // Showing a stage, the end included, stops it.
  function stop() { if (playing) { clearTimeout(playing.timer); playing = null; } }
  function play() {
    stop();
    playing = { pulse: null, timer: null, reported: '' };
    deck.replay();
    tick();
  }
  function tick() {
    if (!playing) return;
    const now = deck.timeline(), next = (now.stage ?? -1) + 1, following = now.stages[next];
    stage = now.stage ?? 0;
    const key = `${stage}:${playing.pulse}`;
    if (key !== playing.reported) { playing.reported = key; post(); }
    if (now.state === 'complete' || (now.state === 'waiting' && !following)) return show(null);
    if (now.state !== 'waiting') { playing.timer = setTimeout(tick, 40); return; }
    // A manual stage waits for the pause; an automatic one held back by an earlier click waits its own gap.
    const manual = following.trigger === 'manual';
    if (manual) { playing.pulse = next; post(); }
    playing.timer = setTimeout(() => {
      playing.pulse = null;
      slide.querySelector(`[data-stage="${next}"]`)?.click();
      tick();
    }, manual ? CLICK_PAUSE_MS : Math.max(0, following.startMs - now.timeMs));
  }
  // Text on the slide (spec #46, Slide Editor): the editor makes the frame live for one edit and asks
  // for the text at a point. The element itself becomes plain-text editable, so the text keeps the
  // slide's own font, size and position. Enter (single-line fields) or clicking off commits, Escape
  // restores the saved text; each change of the text is reported so the editor can commit it on close.
  let editing = null, swallowClick = false;
  // The saved field a slide element shows: title, body, a column's title or body, or a step label.
  function fieldOf(node) {
    const element = node?.closest?.('h1, h2, p, button[data-stage]');
    if (!element || !slide.contains(element)) return null;
    if (element.matches('.copy > h1')) return { element, name: 'title' };
    if (element.matches('.copy > .lede')) return { element, name: 'body', multiline: true };
    const column = element.closest('.columns > section');
    if (column) {
      const index = [...column.parentElement.children].indexOf(column);
      if (element.matches('section > h2')) return { element, name: 'columns.title', index };
      if (element.matches('section > p')) return { element, name: 'columns.body', index, multiline: true };
      return null;
    }
    if (element.matches('[data-step] > h2')) return { element, name: 'stages.title', index: Number(element.parentElement.dataset.step) };
    if (element.matches('button[data-stage]') && !element.closest('.stage-nav-compact')) return { element, name: 'stages.title', index: Number(element.dataset.stage) };
    return null;
  }
  // The element's text as saved: a line break is a newline, and a typed no-break space a space.
  function textOf(element) {
    let text = '';
    for (const node of element.childNodes) text += node.nodeType === Node.TEXT_NODE ? node.data : node.nodeName === 'BR' ? '\n' : textOf(node);
    return text;
  }
  // The text a commit would save, or null when it would save nothing (unchanged, or a required field left empty).
  function committable() {
    let text = textOf(editing.element).replaceAll(' ', ' ');
    // An editable element ends with a placeholder break once its last line is empty.
    if (editing.element.lastChild?.nodeName === 'BR') text = text.replace(/\n$/, '');
    if (!editing.multiline) text = text.replace(/\s*\n\s*/g, ' ');
    return text === editing.saved || (editing.name !== 'body' && editing.name !== 'columns.body' && !text.trim()) ? null : text;
  }
  const report = (phase, text = null) => window.parent.postMessage({ type: 'storybench-canvas-text', version: 1, phase,
    field: editing && { name: editing.name, index: editing.index ?? null }, text }, '*');
  function edit(x, y) {
    stop();
    const field = fieldOf(document.elementFromPoint(x, y));
    if (!field) return window.parent.postMessage({ type: 'storybench-canvas-text', version: 1, phase: 'none', field: null, text: null }, '*');
    const { element } = field;
    editing = { ...field, original: [...element.childNodes].map((node) => node.cloneNode(true)), saved: textOf(element) };
    element.setAttribute('contenteditable', 'plaintext-only');
    element.spellcheck = false;
    Object.assign(element.style, { outline: '2px solid var(--accent)', outlineOffset: '4px' });
    element.focus({ preventScroll: true });
    // The caret goes where the double-click was.
    const point = document.caretPositionFromPoint?.(x, y) ?? document.caretRangeFromPoint?.(x, y);
    const node = point?.offsetNode ?? point?.startContainer, selection = getSelection();
    if (node && element.contains(node)) selection.collapse(node, point.offset ?? point.startOffset);
    else { selection.selectAllChildren(element); selection.collapseToEnd(); }
    report('start');
  }
  function end(commit) {
    if (!editing) return;
    const text = commit ? committable() : null, { element } = editing;
    report('end', text);
    if (text === null) element.replaceChildren(...editing.original.map((node) => node.cloneNode(true)));
    editing = null;
    element.removeAttribute('contenteditable');
    element.style.removeProperty('outline'); element.style.removeProperty('outline-offset');
    getSelection().removeAllRanges();
    element.blur();
    post();
  }
  // While editing, keys and clicks belong to the text, not the runtime's stage controls.
  window.addEventListener('keydown', (event) => {
    if (!editing) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); end(false); }
    else if (event.key === 'Enter' && !editing.multiline) { event.preventDefault(); end(true); }
    // A space typed in a button would press it.
    else if (event.key === ' ' && editing.element.matches('button')) { event.preventDefault(); document.execCommand('insertText', false, ' '); }
  }, true);
  window.addEventListener('keyup', (event) => { if (editing) { event.stopImmediatePropagation(); event.preventDefault(); } }, true);
  window.addEventListener('pointerdown', (event) => {
    if (!editing || editing.element.contains(event.target)) return;
    event.preventDefault(); swallowClick = true; end(true);
  }, true);
  window.addEventListener('click', (event) => {
    if (!swallowClick && !editing?.element.contains(event.target)) return;
    swallowClick = false; event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  // Pasted formatting is dropped; a single-line field takes pasted lines as one.
  window.addEventListener('paste', (event) => {
    if (!editing) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, editing.multiline ? text : text.replace(/\s*\n\s*/g, ' '));
  }, true);
  window.addEventListener('drop', (event) => { if (editing) event.preventDefault(); }, true);
  window.addEventListener('input', () => { if (editing) report('input', committable()); });
  // Focus leaving the text (Tab, or a click in the app) is a click-off.
  window.addEventListener('focusout', (event) => { if (editing && event.target === editing.element) end(true); });
  window.addEventListener('blur', () => end(true));

  // No media plays on the canvas.
  document.addEventListener('play', (event) => event.target.pause(), true);
  // A slide taller than the frame scrolls in the bundle; the editor scrolls it here (wheel, or a block taking focus).
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data) return;
    if (data.type === 'storybench-canvas-show') show(data.stage);
    else if (data.type === 'storybench-canvas-play') play();
    else if (data.type === 'storybench-canvas-edit' && Number.isFinite(data.x) && Number.isFinite(data.y) && !editing) edit(data.x, data.y);
    else if (data.type === 'storybench-canvas-scroll' && Number.isFinite(data.by)) presentation.scrollTop += data.by;
    else if (data.type === 'storybench-canvas-reveal' && Object.hasOwn(BLOCKS, data.block)) {
      const box = union(boxes(slide.querySelector(BLOCKS[data.block]))), area = presentation.getBoundingClientRect();
      if (box && (box.top < area.top || box.top + box.height > area.bottom)) presentation.scrollTop += box.top - area.top - Math.max(0, (area.height - box.height) / 2);
    }
  });
  presentation.addEventListener('scroll', post, { passive: true });
  new ResizeObserver(post).observe(slide);
  document.fonts.ready.then(post);
  // The editor reopens a rebuilt slide where the last frame was: ?stage=<n>&scroll=<px> (the runtime owns the hash).
  const opening = new URLSearchParams(location.search);
  let wanted = Number(opening.get('scroll')) || 0;
  const restore = () => { if (wanted) presentation.scrollTop = wanted; };
  show(opening.has('stage') ? Number(opening.get('stage')) : null);
  // Media and fonts settle the slide's height after this; scroll again then, unless the editor scrolled since.
  restore(); window.addEventListener('load', restore); document.fonts.ready.then(restore);
  window.addEventListener('message', (event) => { if (event.source === window.parent && event.data?.type === 'storybench-canvas-scroll') wanted = 0; });
})();
