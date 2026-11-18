// Slides canvas bridge (spec #44, Editing by selection). Served only with the canvas build of one
// slide, never in a bundle. It holds the slide still at a stage (default: full reveal) and reports
// where its selectable blocks are, so the editor can draw selection over the frame without reaching
// into it. The frame keeps the bundle's sandbox: everything crosses by postMessage.
(() => {
  'use strict';
  const deck = window.storybenchDeck, slide = document.querySelector('.slide');
  const presentation = document.getElementById('presentation');
  if (!deck || !slide || window.parent === window) return;
  const BLOCKS = { copy: '.copy', stageText: '.stage-text', visual: '.visual' };
  let stage = null;
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
      stages: deck.timeline().stages.length, area: { left: area.left, top: area.top, width: area.width, height: area.height }, blocks,
      scroll: { top: presentation.scrollTop, max: presentation.scrollHeight - presentation.clientHeight } }, '*');
  }
  // A stage is shown at the end of its own motion, before the next stage begins; null is the full reveal.
  function show(value) {
    const { stages, durationMs } = deck.timeline();
    stage = Number.isInteger(value) && value >= 0 && value < stages.length - 1 ? value : null;
    const time = stage === null ? durationMs : Math.max(stages[stage].startMs, Math.min(stages[stage].motionEndMs, stages[stage + 1].startMs - 0.5));
    deck.seek(time);
    post();
  }
  // No motion plays on the canvas, media included.
  document.addEventListener('play', (event) => event.target.pause(), true);
  // A slide taller than the frame scrolls in the bundle; the editor scrolls it here (wheel, or a block taking focus).
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data) return;
    if (data.type === 'storybench-canvas-show') show(data.stage);
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
