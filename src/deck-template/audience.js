(() => {
  'use strict';
  const slides = [...document.querySelectorAll('.slide')];
  const links = [...document.querySelectorAll('[data-go]')];
  const status = document.getElementById('status');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = Math.max(0, slides.findIndex((slide) => `#${slide.id}` === location.hash));
  let stage = 0, timer, manual = false, popup = null, channel = '', lastSeen = 0;
  const steps = () => [...slides[index].querySelectorAll('[data-step]')];
  const video = () => [...slides[index].querySelectorAll('video')].find((target) => !target.closest('[hidden]'));
  const pauseVideos = () => document.querySelectorAll('video').forEach((target) => target.pause());
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  function state() {
    return { index, stage, titles: slides.map((slide) => slide.dataset.title),
      notes: slides[index].querySelector('.speaker-notes').textContent,
      stages: [...slides[index].querySelectorAll('[data-stage]')].map((button) => button.textContent),
      targetMinutes: Number(slides[index].dataset.minutes),
      video: video() ? { paused: video().paused } : null };
  }
  function publish() {
    if (popup && !popup.closed) popup.postMessage({ type: 'deck-state', channel, state: state() }, '*');
  }
  function paintStage() {
    steps().forEach((step, i) => { step.dataset.pending = String(i > stage && !reduced.matches); });
    slides[index].querySelectorAll('[data-stage]').forEach((button, i) => button.setAttribute('aria-pressed', String(i === stage)));
    publish();
  }
  function schedule() {
    cancel();
    if (manual || document.hidden || reduced.matches) return;
    const next = steps()[stage + 1];
    if (!next || !Number(next.dataset.delay)) return;
    timer = setTimeout(() => { stage++; paintStage(); schedule(); }, Number(next.dataset.delay));
  }
  function takeOver() { manual = true; cancel(); }
  function selectStage(value) {
    if (!Number.isInteger(value) || value < 0 || value >= steps().length) return;
    takeOver(); stage = value; paintStage();
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
      cancel(); pauseVideos(); index = next; stage = 0; manual = false;
      document.getElementById('presentation').focus({ preventScroll: true });
    }
    slides.forEach((slide, i) => { slide.hidden = i !== index; });
    links.forEach((button, i) => { if (i === index) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
    document.querySelector('[data-command="previous"]').disabled = index === 0;
    document.querySelector('[data-command="next"]').disabled = index === slides.length - 1;
    document.getElementById('counter').textContent = `${index + 1} / ${slides.length} · ${slides[index].dataset.title}`;
    try { history.replaceState(null, '', `#${slides[index].id}`); } catch { /* File pages may restrict history. */ }
    paintStage(); schedule();
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
    if (!popup || event.source !== popup || !data || typeof data !== 'object' || data.channel !== channel) return;
    if (data.type === 'deck-ready' || data.type === 'deck-ping') { lastSeen = Date.now(); publish(); }
    else if (data.type === 'deck-command' && typeof data.command === 'string') command(data.command, data.index);
  });
  window.addEventListener('pagehide', () => {
    cancel(); pauseVideos();
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
    const name = { ArrowUp: 'previous', ArrowDown: 'next', ArrowLeft: 'sub-previous', ArrowRight: 'sub-next', Home: 'first', End: 'last' }[event.key];
    if (name) { event.preventDefault(); command(name); }
    else if (event.key.toLowerCase() === 'n') { event.preventDefault(); openPresenter(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancel(); pauseVideos(); } else schedule();
  });
  reduced.addEventListener('change', () => { paintStage(); schedule(); });
  window.addEventListener('hashchange', () => {
    const found = slides.findIndex((slide) => `#${slide.id}` === location.hash);
    if (found >= 0) show(found);
  });
  show(index);
})();
