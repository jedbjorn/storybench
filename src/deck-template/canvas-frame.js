// Slides canvas bridge (spec #44, Editing by selection). Served only with the canvas build of one
// slide, never in a bundle. It holds the slide still at a stage (default: full reveal) and reports
// where its selectable blocks are, so the editor can draw selection over the frame without reaching
// into it. The frame keeps the bundle's sandbox: everything crosses by postMessage.
// Play (spec #46, Slide Editor: Play) runs the slide's own timeline from Start; an On click stage is
// clicked after a short pause, and the slide ends held at the full reveal. Play step replays one stage
// from its start state (the stages before it shown complete) and holds that stage when its motion ends.
(() => {
  'use strict';
  const deck = window.storybenchDeck, slide = document.querySelector('.slide');
  if (!deck || !slide || window.parent === window) return;
  const standardsRevision = Number(document.currentScript.dataset.standardsRevision);
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
  const textFields = { title: slide.querySelector('.copy > h1'), body: slide.querySelector('.copy > .lede') };
  function post() {
    const area = slide.getBoundingClientRect(), blocks = {};
    for (const [key, selector] of Object.entries(BLOCKS)) {
      const box = union(boxes(slide.querySelector(selector)));
      if (box) blocks[key] = box;
    }
    const fields = {};
    for (const [key, element] of Object.entries(textFields)) {
      const box = union(boxes(element));
      if (box) fields[key] = box;
    }
    window.parent.postMessage({ type: 'storybench-canvas', fields, version: 1, slideId: slide.id, standardsRevision, stage,
      playing: Boolean(playing), overflow: deck.overflowRegions(), pulse: playing?.pulse ?? null, stages: deck.timeline().stages.length, area: { left: area.left, top: area.top, width: area.width, height: area.height }, blocks,
      scroll: { top: 0, max: 0 } }, '*');
  }
  // A stage is shown at the end of its own motion, before the next stage begins; null is the full reveal.
  // Any stage index the slide has is kept as asked (the editor normalizes by the same rule), the last included.
  const heldAt = (stages, i) => Math.max(stages[i].startMs, Math.min(stages[i].motionEndMs, (stages[i + 1]?.startMs ?? Infinity) - 0.5));
  function show(value) {
    stop();
    const { stages, durationMs } = deck.timeline();
    stage = Number.isInteger(value) && value >= 0 && value < stages.length ? value : null;
    if (stages.length) deck.holdStage(stage ?? stages.length - 1);
    else deck.seek(durationMs);
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
  function playStep(value) {
    const { stages } = deck.timeline();
    if (!Number.isInteger(value) || value < 0 || value >= stages.length) return;
    // The first stage replays with the slide; a later one is clicked from the end of the one before it,
    // which plays its motion once. An automatic stage that starts with the one before it is already
    // current there, so it plays from its own start instead, with any stage that starts with it.
    // Nothing is reported until it plays: the editor would hold a stage reported on the way.
    stop();
    if (value === 0) deck.replay();
    else if ((deck.seek(heldAt(stages, value - 1)).stage ?? -1) >= value) { deck.seek(stages[value].startMs); deck.resume(); }
    else deck.selectStage(value);
    playing = { pulse: null, timer: null, reported: '', until: value };
    tick();
  }
  function tick() {
    if (!playing) return;
    const now = deck.timeline(), next = (now.stage ?? -1) + 1, following = now.stages[next];
    stage = now.stage ?? 0;
    const key = `${stage}:${playing.pulse}`;
    if (key !== playing.reported) { playing.reported = key; post(); }
    if (playing.until !== undefined) {
      // It holds at the stage's motion end, or where a later stage starts; one that starts with it plays along.
      const { startMs, motionEndMs } = now.stages[playing.until], later = now.stages[now.stage ?? 0].startMs > startMs;
      if (now.state === 'playing' && now.timeMs < motionEndMs && !((now.stage ?? 0) > playing.until && later)) { playing.timer = setTimeout(tick, 40); return; }
      return show(playing.until);
    }
    if (now.state === 'complete' || (now.state === 'waiting' && !following)) return show(null);
    if (now.state !== 'waiting') { playing.timer = setTimeout(tick, 40); return; }
    // A manual stage waits for the pause; an automatic one held back by an earlier click waits its own gap.
    const manual = following.trigger === 'manual';
    if (manual) { playing.pulse = next; post(); }
    playing.timer = setTimeout(() => {
      playing.pulse = null;
      deck.selectStage(next);
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
    const hit = node?.closest?.('h1, h2, p, button[data-stage]');
    const element = hit?.querySelector('button[data-stage]') || hit;
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
    if (element.matches('button[data-stage]')) return { element, name: 'stages.title', index: Number(element.dataset.stage) };
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
  // Only the parent editor can change the held frame or preview a width.
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data) return;
    if (data.type === 'storybench-canvas-width' && Object.hasOwn(textFields, data.field)) {
      const element = textFields[data.field];
      if (!element) return;
      if (data.width === null) element.style.removeProperty('width');
      else if (Number.isFinite(data.width) && data.width >= 20 && data.width <= 100) element.style.width = `${data.width}%`;
      post();
    } else if (data.type === 'storybench-canvas-show') show(data.stage);
    else if (data.type === 'storybench-canvas-play') play();
    else if (data.type === 'storybench-canvas-edit' && Number.isFinite(data.x) && Number.isFinite(data.y) && !editing) edit(data.x, data.y);
    else if (data.type === 'storybench-canvas-play-step') playStep(data.stage);
  });
  new ResizeObserver(post).observe(slide);
  document.fonts.ready.then(post);
  // The editor reopens the held stage. The audience runtime owns the hash.
  const opening = new URLSearchParams(location.search);
  show(opening.has('stage') ? Number(opening.get('stage')) : null);
})();
