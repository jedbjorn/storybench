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
  // No media plays on the canvas.
  document.addEventListener('play', (event) => event.target.pause(), true);
  // A slide taller than the frame scrolls in the bundle; the editor scrolls it here (wheel, or a block taking focus).
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data) return;
    if (data.type === 'storybench-canvas-show') show(data.stage);
    else if (data.type === 'storybench-canvas-play') play();
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
