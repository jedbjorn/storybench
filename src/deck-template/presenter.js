(() => {
  'use strict';
  const channel = location.hash.slice(1), audience = window.opener;
  const connection = document.getElementById('connection');
  const slides = document.getElementById('slide-select'), stages = document.getElementById('stage-select');
  let connected = false, lastSeen = Date.now();
  function disconnect() {
    connected = false;
    connection.textContent = 'Audience disconnected. Reopen Presenter from the presentation.';
    document.querySelectorAll('button,select').forEach((control) => { control.disabled = true; });
  }
  function send(type, extra = {}) {
    if (audience && !audience.closed) audience.postMessage({ type, channel, ...extra }, '*');
  }
  function command(name, index) { if (connected) send('deck-command', { command: name, index }); }
  function valid(state) {
    return state && Array.isArray(state.titles) && state.titles.length > 0 && state.titles.every((title) => typeof title === 'string') &&
      Number.isInteger(state.index) && state.index >= 0 && state.index < state.titles.length && typeof state.notes === 'string' &&
      Array.isArray(state.stages) && state.stages.every((label) => typeof label === 'string') &&
      Number.isInteger(state.stage) && state.stage >= 0 && state.stage < Math.max(1, state.stages.length) &&
      Number.isFinite(state.targetMinutes) && state.targetMinutes >= 0 &&
      (state.video === null || (state.video && typeof state.video.paused === 'boolean'));
  }
  function options(select, labels, selected) {
    select.replaceChildren(...labels.map((label, i) => new Option(label, String(i))));
    select.value = String(selected); select.disabled = !labels.length;
  }
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!audience || event.source !== audience || !data || typeof data !== 'object' || data.channel !== channel) return;
    if (data.type === 'deck-closed') { disconnect(); return; }
    if (data.type !== 'deck-state' || !valid(data.state)) return;
    const state = data.state; connected = true; lastSeen = Date.now();
    connection.textContent = `Connected · Target ${state.targetMinutes} min`;
    document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    options(slides, state.titles, state.index); options(stages, state.stages, state.stage);
    document.getElementById('current-title').textContent = state.titles[state.index];
    document.getElementById('next-title').textContent = state.titles[state.index + 1] || 'End of presentation';
    document.getElementById('notes').textContent = state.notes;
    document.getElementById('counter').textContent = `${state.index + 1} / ${state.titles.length}`;
    document.querySelector('[data-command="previous"]').disabled = state.index === 0;
    document.querySelector('[data-command="next"]').disabled = state.index === state.titles.length - 1;
    document.querySelector('[data-command="sub-previous"]').disabled = !state.stages.length || state.stage === 0;
    document.querySelector('[data-command="sub-next"]').disabled = !state.stages.length || state.stage === state.stages.length - 1;
    for (const name of ['video-toggle', 'video-restart']) document.querySelector(`[data-command="${name}"]`).disabled = !state.video;
    document.getElementById('video-status').textContent = state.video ? (state.video.paused ? 'Video paused' : 'Video playing') : 'No video on this slide';
  });
  document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => command(button.dataset.command)));
  slides.addEventListener('change', () => command('goto', Number(slides.value)));
  stages.addEventListener('change', () => command('stage', Number(stages.value)));
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    const name = { ArrowUp: 'previous', ArrowDown: 'next', ArrowLeft: 'sub-previous', ArrowRight: 'sub-next', Home: 'first', End: 'last', ' ': 'video-toggle' }[event.key];
    if (name) { event.preventDefault(); command(name); }
  });
  disconnect();
  if (!audience || audience.closed || !/^[a-f0-9]{32}$/.test(channel)) return;
  connection.textContent = 'Connecting to audience…';
  send('deck-ready');
  const heartbeat = setInterval(() => {
    if (audience.closed) { disconnect(); clearInterval(heartbeat); return; }
    send('deck-ping');
    if (Date.now() - lastSeen > 5000) disconnect();
  }, 1000);
})();
