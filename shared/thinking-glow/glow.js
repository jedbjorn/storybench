(() => {
  'use strict';
  let mode = 'presentation';
  const scenes = Array.from(document.querySelectorAll('canvas')).map(canvas => ({
    canvas, context: canvas.getContext('2d'), treatment: canvas.dataset.treatment,
  }));
  const started = performance.now();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const prompts = {
    presentation: 'Let’s turn these ideas into a deck. Start by putting them in order.',
    video: 'Let’s turn these ideas into a video. Start by putting the story in order.',
  };
  function render(now) {
    const phase = reduced.matches ? .57 : ((now - started) % 10000) / 10000;
    for (const scene of scenes) window.MosaicGlow.draw(scene.context, phase, mode, scene.treatment);
  }
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      document.querySelectorAll('.prompt').forEach(item => { item.textContent = prompts[mode]; });
      document.querySelectorAll('.input-mock').forEach(item => { item.textContent = `Ask the ${mode === 'video' ? 'video' : 'deck'} assistant, or drop an image`; });
      for (const scene of scenes) scene.canvas.setAttribute('aria-label', `${scene.treatment} mosaic thinking animation for ${mode}: collecting, arranging, creating, and flowing back into the loop.`);
      render(performance.now());
    });
  });
  let lastDraw = -Infinity;
  function frame(now) {
    if (!document.hidden && !reduced.matches && now - lastDraw >= 1000 / 30) {
      render(now);
      lastDraw = now;
    }
    requestAnimationFrame(frame);
  }
  reduced.addEventListener('change', () => render(performance.now()));
  render(started);
  requestAnimationFrame(frame);
})();
