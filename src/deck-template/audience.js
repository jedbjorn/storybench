(() => {
  'use strict';
  const slides = [...document.querySelectorAll('.slide')];
  const presentation = document.getElementById('presentation');
  const frameHeight = presentation.dataset.ratio === '16:10' ? 1200 : 1080;
  function fitFrame() {
    const scale = Math.min(presentation.clientWidth / 1920, presentation.clientHeight / frameHeight);
    presentation.style.setProperty('--frame-scale', scale);
  }
  fitFrame();
  if (window.ResizeObserver) new ResizeObserver(fitFrame).observe(presentation);

  // Pending stages occupy their final layout slots, including the tallest card face.
  // Inspect those slots even while the editor holds an earlier reveal.
  function overflowRegions() {
    const slide = slides[index];
    if (printMedia.matches) return [];
    const regions = new Set();
    // An authored Visual can reach into the slide gutters up to the delivery frame.
    const style = getComputedStyle(slide);
    const visualInset = (edge, gutter) => Math.max(0, gutter + Math.min(0, parseFloat(style.getPropertyValue('--visual-' + edge)) || 0));
    const visualBounds = [visualInset('left', 67), visualInset('right', 67), visualInset('top', 27), visualInset('bottom', 27)];
    for (const el of slide.querySelectorAll('.copy > *, .columns section, [data-step] > *, figure, figcaption, .caption, .stage-nav, .gallery-nav')) {
      if (!el.getClientRects().length || el.closest('[hidden]')) continue;
      // Layout coordinates exclude the pending slide-in and card flip transforms.
      let left = 0, top = 0;
      for (let parent = el; parent && parent !== slide; parent = parent.offsetParent) {
        left += parent.offsetLeft; top += parent.offsetTop;
      }
      const [start, end, above, below] = el.closest('.visual-content') ? visualBounds : [67, 67, 27, 27];
      if (el.offsetWidth && el.offsetHeight && left >= start && left + el.offsetWidth <= 1920 - end &&
          top >= above && top + el.offsetHeight <= frameHeight - below && el.scrollWidth <= el.clientWidth + 1) continue;
      const step = el.closest('[data-step]');
      regions.add(step ? `Step ${Number(step.dataset.step) + 1}` :
        el.matches('h1') ? 'Title' : el.matches('.lede') ? 'Body' : el.matches('.caption') ? 'Caption' : el.closest('.columns') ? 'Columns' :
        el.closest('.visual') ? 'Visual' : 'Stage text');
    }
    return [...regions];
  }
  const links = [...document.querySelectorAll('[data-go]')];
  const status = document.getElementById('status');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const printMedia = window.matchMedia('print');
  let index = Math.max(0, slides.findIndex((slide) => `#${slide.id}` === location.hash));
  let stage = 0, timer, frame, manual = false, popup = null, channel = '', lastSeen = 0;
  // One timeline per slide. `held` is its time while stopped; while `live`, `origin` is the instant of time zero.
  // `wants`: it should run; `halted`: paused through the API; `settled`: stages up to here show their end state.
  let opening = false, printing = printMedia.matches, live = false, wants = false, halted = false;
  let held = 0, origin = 0, settled = -1, visit = 0;
  const FADE_MS = 450, FLIP_MS = 400, REST = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };
  const bezier = (x1, y1, x2, y2) => (x) => {
    const at = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
    let low = 0, high = 1;
    for (let i = 0; i < 30; i++) { const t = (low + high) / 2; if (at(t, x1, x2) < x) low = t; else high = t; }
    return at((low + high) / 2, y1, y2);
  };
  const curves = { linear: (x) => x, 'ease-in': bezier(0.42, 0, 1, 1), 'ease-out': bezier(0, 0, 0.58, 1), 'ease-in-out': bezier(0.42, 0, 0.58, 1) };
  const standard = bezier(0.25, 0.1, 0.25, 1); // CSS `ease`, the curve of the standard short fade.
  const mix = (a, b, e) => Object.fromEntries(Object.keys(REST).map((key) => [key, e >= 1 ? b[key] : a[key] + (b[key] - a[key]) * e]));
  // Each slide's timeline, computed once from its stage attributes (README: Timeline).
  const models = new Map();
  function model(i = index) {
    if (models.has(i)) return models.get(i);
    let previous = null, rest = 0;
    // Stage text settings that shape the timeline: a slide-wide gap (timing.betweenMs) and the card's flip.
    const box = slides[i].querySelector('.stages'), card = Boolean(box?.classList.contains('stage-card'));
    const between = box?.dataset.betweenMs === undefined ? null : Number(box.dataset.betweenMs);
    const flipMs = box?.dataset.flipMs === undefined ? FLIP_MS : Number(box.dataset.flipMs);
    const plan = [...slides[i].querySelectorAll('.stages > [data-step]')].map((el, n) => {
      const motion = el.dataset.motion ? JSON.parse(el.dataset.motion) : {}, delay = Number(el.dataset.delay) || 0;
      // With a slide-wide gap every stage after the first starts that long after the previous one's motion ends.
      const gap = n > 0 && between !== null;
      const auto = gap || (motion.trigger ? motion.trigger === 'auto' : delay > 0);
      const timed = motion.durationMs !== undefined, kind = motion.motion || 'fade';
      // An automatic stage follows the previous stage's hold; a manual one waits until everything before it is still.
      const start = gap ? previous.motionEnd + between : auto ? (previous ? previous.holdEnd : 0) + delay : rest;
      // An unset duration is the short fade and does not push the next stage. A first stage nobody waits for is simply there.
      const length = timed ? motion.durationMs : !n && !auto && kind === 'fade' ? 0 : FADE_MS;
      // The card flips to each stage as it starts; the flip is part of that stage's motion.
      const flip = card && (n > 0 || auto) ? flipMs : 0;
      previous = { el, id: el.dataset.stageId ?? null, auto, kind, start, length, flip, motionEnd: start + Math.max(length, flip),
        holdEnd: start + (timed ? motion.durationMs : 0) + (motion.holdMs ?? 0),
        ease: curves[motion.easing] || standard, from: motion.from || {}, changes: motion.changes || [] };
      rest = Math.max(rest, previous.motionEnd, previous.holdEnd);
      return previous;
    });
    const groups = [...slides[i].querySelectorAll('[data-vector-step]')].map((el) => ({ el, step: Number(el.dataset.vectorStep), parts: null, drawing: false,
      changes: plan.flatMap((entry, n) => entry.changes.filter((change) => change.groupId === el.dataset.vectorGroup).map((change) => ({ step: n, to: change.to }))) }));
    const value = { plan, groups, card, end: rest };
    models.set(i, value); return value;
  }
  const next = () => model().plan[opening ? 0 : stage + 1];
  // The clock stops where nothing more happens without a person: before a manual stage, at the end,
  // or once a hand-picked stage has played.
  function limit() {
    const { plan, end } = model(), following = next();
    if (!plan.length) return 0;
    if (!manual) return following ? (following.auto ? Infinity : following.start) : end;
    return Math.max(plan[stage].motionEnd, ...plan.slice(settled + 1, stage + 1).map((entry) => entry.motionEnd));
  }
  const clock = () => live ? Math.min(Date.now() - origin, limit()) : held;
  const final = () => reduced.matches || printing;
  // How far a stage's motion is at time t: null before it begins, 1 once complete.
  function progress(entry, n, t) {
    if (final()) return 1;
    if (opening || n > stage) return null;
    return n <= settled || !entry.length ? 1 : Math.max(0, Math.min(1, (t - entry.start) / entry.length));
  }
  const moving = () => { const t = clock(); return !opening && model().plan.some((entry, n) => n <= stage && n > settled && t < entry.motionEnd); };
  const video = () => [...slides[index].querySelectorAll('video')].find((target) => !target.closest('[hidden]'));
  const pauseVideos = () => document.querySelectorAll('video').forEach((target) => target.pause());
  // Stop the clock where it is; nothing is left scheduled.
  function freeze() {
    held = clock(); live = false;
    clearTimeout(timer); timer = undefined; cancelAnimationFrame(frame);
  }
  function state() {
    return { index, stage, titles: slides.map((slide) => slide.dataset.title),
      notes: slides[index].querySelector('.speaker-notes').textContent,
      stages: model().plan.map(entry => entry.el.dataset.navLabel),
      targetMinutes: Number(slides[index].dataset.minutes),
      video: video() ? { paused: video().paused } : null };
  }
  // Framed (Storybench Preview, or any page embedding an export): report the viewed
  // position only, never titles, notes or content. Standalone pages post nothing.
  const framed = window.parent !== window;
  let reported = '';
  function report(always = false) {
    if (!framed) return;
    const view = slides[index].querySelector('[data-gallery-view]:not([hidden])');
    const message = { type: 'storybench-deck-state', version: 1, slideId: slides[index].id, index,
      stage: model().plan.length && !opening ? stage : null, gallery: view ? Number(view.dataset.galleryView) : null };
    const key = JSON.stringify(message);
    if (!always && key === reported) return;
    reported = key; window.parent.postMessage(message, '*');
  }
  function publish() {
    if (popup && !popup.closed) popup.postMessage({ type: 'deck-state', channel, state: state() }, '*');
    report();
  }
  const flag = (el, pending) => { if (el.dataset.pending !== String(pending)) el.dataset.pending = String(pending); };
  // Draw: strokes run along their length; fills and unstroked parts arrive as the strokes complete.
  // At the end every part is exactly as authored.
  function draw(group, amount) {
    if (amount >= 1 && !group.drawing) return;
    group.parts ??= [...group.el.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon,text,use')].filter((el) => !el.closest('defs,clipPath,mask')).map((el) => {
      const style = getComputedStyle(el), number = (value) => Number.isFinite(Number(value)) ? Number(value) : 1;
      let length = 0;
      if (style.stroke !== 'none' && el.getTotalLength) try { length = el.getTotalLength(); } catch { /* Not rendered geometry. */ }
      // Only these inline properties are ever touched, and each is put back as authored.
      const saved = ['stroke-dasharray', 'stroke-dashoffset', 'fill-opacity', 'opacity'].map((name) => [name, el.style.getPropertyValue(name)]);
      return { el, length, saved, fill: number(style.fillOpacity), opacity: number(style.opacity) };
    });
    group.drawing = amount < 1;
    const late = Math.max(0, (amount - 0.8) / 0.2);
    for (const part of group.parts) {
      if (amount >= 1) for (const [name, value] of part.saved) part.el.style.setProperty(name, value);
      else if (part.length) {
        part.el.style.strokeDasharray = `${part.length} ${part.length}`;
        part.el.style.strokeDashoffset = part.length * (1 - amount);
        part.el.style.fillOpacity = part.fill * late;
      } else part.el.style.opacity = part.opacity * late;
    }
  }
  // The whole look of a slide is a function of the timeline's time, so any moment can be shown exactly.
  function paintSlide(i, t) {
    const { plan, groups, card } = model(i);
    if (card) paintCard(plan, t);
    else plan.forEach((entry, n) => {
      const p = progress(entry, n, t), e = p === null || p >= 1 ? null : entry.ease(p);
      flag(entry.el, p === null);
      entry.el.style.opacity = e === null ? '' : e;
      entry.el.style.transform = e === null ? '' : `translateY(${12 * (1 - e)}px)`;
    });
    for (const group of groups) {
      const entry = plan[group.step], p = progress(entry, group.step, t);
      flag(group.el, p === null);
      if (group.el.getAttribute('aria-hidden') !== String(p === null)) group.el.setAttribute('aria-hidden', String(p === null));
      let state = REST, fade = 1, drawn = 1;
      if (p !== null && p < 1) {
        const e = entry.ease(p);
        if (entry.kind === 'enter') state = mix({ ...REST, ...entry.from }, REST, e);
        else if (entry.kind === 'draw') drawn = e;
        else fade = e;
      }
      // Changes accumulate: each starts from the state the stage before it left.
      if (p !== null) for (const change of group.changes) {
        const q = progress(plan[change.step], change.step, t);
        if (q === null) break;
        state = mix(state, { ...state, ...change.to }, q >= 1 ? 1 : plan[change.step].ease(q));
      }
      draw(group, drawn);
      const opacity = drawn > 0 ? state.opacity * fade : 0;
      group.el.style.opacity = p === null || opacity === 1 ? '' : opacity;
      group.el.style.transform = p === null || (!state.x && !state.y && state.scale === 1 && !state.rotate) ? ''
        : `translate(${state.x}px,${state.y}px) rotate(${state.rotate}deg) scale(${state.scale})`;
    }
  }
  // The card shows one face: the latest stage begun. Mid-flip, the outgoing face turns away over the
  // first half and the incoming face turns in over the second. Reduced motion swaps faces without turning.
  function paintCard(plan, t) {
    let current = -1;
    plan.forEach((entry, n) => { if (final() ? n <= stage : progress(entry, n, t) !== null) current = n; });
    const entry = plan[current], f = !entry || final() || !entry.flip ? 1 : Math.max(0, Math.min(1, (t - entry.start) / entry.flip));
    const e = f >= 1 ? 1 : entry.ease(f), shown = e < 0.5 ? current - 1 : current;
    plan.forEach((face, n) => {
      flag(face.el, n !== shown);
      face.el.style.opacity = '';
      face.el.style.transform = n !== shown || e >= 1 ? '' : `rotateY(${n === current ? (e - 1) * 180 : e * 180}deg)`;
    });
  }
  function paintFrame() {
    const t = clock();
    // Print lays out every slide, so each shows its final state.
    if (printing) slides.forEach((_, i) => paintSlide(i, t)); else paintSlide(index, t);
  }
  function paintStage() {
    paintFrame();
    // A hidden list entry still runs. Keep the preceding visible label current until the next one starts.
    const plan = model().plan;
    let label = opening ? -1 : stage;
    while (label >= 0 && plan[label]?.el.hidden) label--;
    slides[index].querySelectorAll('[data-stage]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.stage) === label)));
    plan.forEach(({ el }, i) => { if (i === label) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
    publish();
  }
  function advance() {
    for (let following; !manual && (following = next())?.auto && following.start <= clock();) { if (opening) opening = false; else stage++; }
  }
  function animate() {
    cancelAnimationFrame(frame);
    if (live && moving()) frame = requestAnimationFrame(() => { const more = moving(); paintFrame(); if (more) animate(); });
  }
  // Reconcile the clock, the next stage's timer and the frame loop with the current intent.
  // A hidden tab, print and reduced motion hold the clock; it resumes from the same time.
  function sync() {
    clearTimeout(timer); timer = undefined; cancelAnimationFrame(frame);
    const run = wants && !halted && !document.hidden && !final();
    if (live && !run) { held = clock(); live = false; }
    else if (!live && run) { origin = Date.now() - held; live = true; }
    if (!live) return;
    const following = next();
    if (!manual && following?.auto) timer = setTimeout(() => { timer = undefined; advance(); paintStage(); sync(); }, Math.max(0, following.start - clock()));
    animate();
  }
  // A person took control (stage or media): no further automatic stages; motion under way completes.
  function takeOver() { manual = true; sync(); }
  function resetStages() {
    freeze();
    const { plan, end } = model();
    manual = false; halted = false; settled = -1; held = 0; visit++; wants = plan.length > 0;
    stage = reduced.matches ? Math.max(0, plan.length - 1) : 0;
    opening = !reduced.matches && Boolean(plan[0]?.auto) && plan[0].start > 0;
    if (reduced.matches) { settled = stage; held = end; }
  }
  function selectStage(value) {
    const { plan } = model();
    if (!Number.isInteger(value) || value < 0 || value >= plan.length) return;
    // One stage forward plays that stage's motion once; any other choice shows its end state at once.
    const step = value === stage + 1 && !opening;
    freeze(); manual = true; halted = false; opening = false; stage = value;
    settled = step ? value - 1 : value; held = step ? plan[value].start : plan[value].motionEnd; wants = step;
    paintStage(); sync();
  }
  function timeline() {
    print(); // A media change is reported a frame late; a caller never reads the timeline behind it.
    const { plan, end } = model(), t = clock();
    const state = reduced.matches ? 'complete' : printing || halted ? 'paused'
      : wants && t < limit() ? (document.hidden ? 'paused' : 'playing') : next() ? 'waiting' : 'complete';
    return { version: 1, slideId: slides[index].id, index, visit, state, timeMs: t, durationMs: end,
      stage: plan.length && !opening ? stage : null,
      stages: plan.map((entry) => ({ id: entry.id, trigger: entry.auto ? 'auto' : 'manual', startMs: entry.start, motionEndMs: entry.motionEnd, holdEndMs: entry.holdEnd })) };
  }
  // Pause the timeline and show the slide exactly as it is at timeMs; resume() plays on from there.
  function seek(timeMs) {
    const { plan, end } = model(), t = Math.max(0, Math.min(end, Number(timeMs) || 0));
    print(); freeze(); manual = false; halted = true; settled = -1; held = t; wants = plan.length > 0;
    opening = plan.length > 0 && t < plan[0].start; stage = 0;
    while (plan[stage + 1] && (plan[stage + 1].auto ? plan[stage + 1].start <= t : plan[stage + 1].start < t)) stage++;
    paintStage();
    return timeline();
  }
  function play(target) {
    if (!target) return;
    const activeIndex = index;
    Promise.resolve().then(() => {
      if (index !== activeIndex || target !== video() || document.hidden) return;
      return target.play();
    }).then(() => {
      if (index !== activeIndex || target !== video() || document.hidden) target.pause();
      publish();
    }).catch(() => { target.controls = true; status.textContent = 'Playback was blocked. Use the video controls to retry.'; publish(); });
  }
  function show(value) {
    if (!Number.isInteger(value)) return;
    const next = Math.max(0, Math.min(slides.length - 1, value));
    if (next !== index) {
      freeze(); pauseVideos(); index = next; resetStages();
      document.getElementById('presentation').focus({ preventScroll: true });
      document.getElementById('presentation').scrollTop = 0;
    }
    slides.forEach((slide, i) => { slide.hidden = i !== index; });
    links.forEach((button, i) => { if (i === index) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
    document.querySelector('[data-command="previous"]').disabled = index === 0;
    document.querySelector('[data-command="next"]').disabled = index === slides.length - 1;
    document.querySelector('footer [data-command="replay"]').hidden = !model().plan.length;
    document.getElementById('counter').textContent = `${index + 1} / ${slides.length} · ${slides[index].dataset.title}`;
    try { history.replaceState(null, '', `#${slides[index].id}`); } catch { /* File pages may restrict history. */ }
    paintStage(); sync();
    if (!manual && !document.hidden && !reduced.matches && video()?.dataset.autoplay === 'true') play(video());
  }
  function command(name, value) {
    if (name === 'previous') show(index - 1);
    else if (name === 'next') show(index + 1);
    else if (name === 'first') show(0);
    else if (name === 'last') show(slides.length - 1);
    else if (name === 'goto' && Number.isInteger(value) && value >= 0 && value < slides.length) show(value);
    else if (name === 'stage') selectStage(value);
    else if (name === 'sub-next') selectStage(stage + 1);
    else if (name === 'sub-previous') selectStage(stage - 1);
    else if (name === 'replay') { resetStages(); paintStage(); sync(); }
    else if (name === 'video-toggle' || name === 'video-restart') {
      takeOver(); const target = video();
      if (target) {
        if (name === 'video-restart') target.currentTime = 0;
        if (name === 'video-toggle' && !target.paused) target.pause(); else play(target);
      }
    }
    publish();
  }
  function openPresenter() {
    if (popup && !popup.closed) { popup.focus(); publish(); return; }
    channel = Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, '0')).join('');
    const url = new URL('presenter.html', location.href); url.hash = channel;
    popup = window.open(url.href, `deck-presenter-${channel}`, 'popup,width=1000,height=800');
    lastSeen = Date.now();
    status.textContent = popup ? '' : 'Popup blocked. Allow popups and click Presenter to retry.';
  }
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (framed && event.source === window.parent && data.type === 'storybench-deck-state-request') { report(true); return; }
    if (!popup || event.source !== popup || data.channel !== channel) return;
    if (data.type === 'deck-ready' || data.type === 'deck-ping') { lastSeen = Date.now(); publish(); }
    else if (data.type === 'deck-command' && typeof data.command === 'string') command(data.command, data.index);
  });
  window.addEventListener('pagehide', () => {
    freeze(); pauseVideos();
    if (popup && !popup.closed) popup.postMessage({ type: 'deck-closed', channel }, '*');
  });
  setInterval(() => {
    if (popup && (popup.closed || Date.now() - lastSeen > 5000)) {
      status.textContent = 'Presenter disconnected. Click Presenter to reopen.';
      popup.close(); popup = null;
    }
  }, 1000);
  links.forEach((button) => button.addEventListener('click', () => show(Number(button.dataset.go))));
  document.querySelectorAll('[data-stage]').forEach((button) => button.addEventListener('click', () => selectStage(Number(button.dataset.stage))));
  document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => command(button.dataset.command)));
  // Gallery views are independent of cumulative diagram reveals.
  document.querySelectorAll('[data-gallery]').forEach((button) => button.addEventListener('click', () => {
    const slide = button.closest('.slide');
    slide.querySelectorAll('[data-gallery-view]').forEach((view) => {
      view.hidden = view.dataset.galleryView !== button.dataset.gallery;
      if (view.hidden) view.querySelectorAll('video').forEach((target) => target.pause());
    });
    publish();
  }));
  document.querySelectorAll('video').forEach((target) => {
    target.addEventListener('pointerdown', takeOver);
    target.addEventListener('keydown', takeOver);
    for (const name of ['play', 'pause', 'ended']) target.addEventListener(name, publish);
    target.addEventListener('error', () => { status.textContent = 'Media unavailable. Check the bundle includes the local media file.'; });
  });
  document.getElementById('presenter-open').addEventListener('click', openPresenter);
  document.getElementById('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      status.textContent = '';
    } catch { status.textContent = 'Fullscreen unavailable. Continue in this window or retry Fullscreen.'; }
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    const name = { ArrowUp: 'previous', ArrowDown: 'next', ArrowLeft: model().plan.length ? 'sub-previous' : 'previous', ArrowRight: model().plan.length ? 'sub-next' : 'next', Home: 'first', End: 'last' }[event.key];
    if (name) { event.preventDefault(); command(name); }
    else if (event.key.toLowerCase() === 'n') { event.preventDefault(); openPresenter(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseVideos();
    sync();
  });
  reduced.addEventListener('change', () => {
    if (reduced.matches) {
      const { plan, end } = model();
      freeze(); manual = true; opening = false; wants = false;
      stage = Math.max(0, plan.length - 1); settled = stage; held = end;
    }
    paintStage(); sync();
  });
  // Printing, and print emulation, hold the clock and show every slide's final state.
  let printEvent = false;
  function print() {
    if (printing === (printEvent || printMedia.matches)) return;
    printing = !printing; paintStage(); sync();
  }
  window.addEventListener('beforeprint', () => { printEvent = true; print(); });
  window.addEventListener('afterprint', () => { printEvent = false; print(); });
  printMedia.addEventListener('change', print);
  // The timeline surface for editors and QA (README: Timeline). Each call returns the timeline as it then is.
  window.storybenchDeck = Object.freeze({
    timeline,
    overflowRegions,
    selectStage,
    holdStage(value) {
      const entry = model().plan[value];
      if (!entry) return;
      freeze(); manual = true; halted = true; wants = false; opening = false;
      stage = value; settled = value; held = value === model().plan.length - 1 ? model().end : entry.motionEnd;
      paintStage();
    },
    seek,
    pause() { halted = true; sync(); return timeline(); },
    resume() { halted = false; sync(); return timeline(); },
    replay() { command('replay'); return timeline(); },
  });
  window.addEventListener('hashchange', () => {
    const found = slides.findIndex((slide) => `#${slide.id}` === location.hash);
    if (found >= 0) show(found);
  });
  resetStages(); show(index);
})();
