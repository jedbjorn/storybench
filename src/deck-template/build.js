import { readFileSync } from 'node:fs';
import { fontForFamily, fontPath } from '../fonts.js';
import { looksLikeSvg, parseSvg } from '../svg.js';
import { stageMotion, validateTextStage, THEME_COLOR_ROLES, TEMPLATE_COLORS } from '../deck-data.js';

const layouts = ['title', 'section', 'statement', 'text-media', 'columns', 'full-media', 'process'];
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = (value, field, optional = false) => {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim())) throw new Error(`${field} must be text`);
  return escape(value);
};
const list = (value, field) => {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
};

function typography(files, families = [], svgFonts = []) {
  if (!Array.isArray(families) || families.length > 3) throw new Error('Deck fonts must be up to three supported families');
  let css = '';
  for (const family of new Set([...families.filter(value => value !== null), ...svgFonts.filter(value => value !== 'Manrope')])) {
    const font = fontForFamily(family);
    if (!font) throw new Error(`Unsupported deck font: ${family}`);
    for (const [weight, key] of [[400, 'regular'], [700, 'bold']]) {
      const source = fontPath(font, key);
      if (!source) throw new Error(`Deck font unavailable: ${font.family} ${key}`);
      const name = `assets/font-${font.id}-${key}.ttf`;
      files.set(name, readFileSync(source));
      css += `@font-face{font-family:"${font.family}";src:url('${name}') format('truetype');font-weight:${weight};font-style:normal;font-display:swap}\n`;
    }
    files.set(`assets/font-${font.id}-LICENSE.txt`, readFileSync(font.license));
  }
  const roles = families.map((family, i) => family == null ? '' : `--font-${['base', 'accent', 'alternate'][i]}:"${fontForFamily(family).family}";`).join('');
  return css + (roles ? `:root{${roles}}\n` : '');
}

// Colour roles (spec #44): base is --ink, accent is --accent, background is --paper. Every other
// template hue is mixed from the roles it depends on, as build-time literals so the bundle needs
// no colour functions offline. A derived hue is written only when one of its roles is set, so an
// unset role keeps the template's own value and a deck with no colours keeps today's stylesheet.
const ROLE_VARIABLES = { base: '--ink', accent: '--accent', background: '--paper' };
const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
/** sRGB mix: `weight` of colour a, the rest of colour b. A weight above 1 pushes a away from b (clamped). */
export const mixColor = (a, b, weight) => '#' + channels(a).map((value, i) => Math.min(255, Math.max(0, Math.round(value * weight + channels(b)[i] * (1 - weight)))).toString(16).padStart(2, '0')).join('').toUpperCase();
export const DERIVED_HUES = Object.freeze([
  ['--muted', ['base', 'background'], c => mixColor(c.base, c.background, 0.78)],
  ['--line', ['base', 'background'], c => mixColor(c.base, c.background, 0.2)],
  ['--rail-fill', ['base', 'background'], c => mixColor(c.base, c.background, 0.04)],
  ['--placeholder', ['base', 'background'], c => mixColor(c.base, c.background, 0.1)],
  // The slide's glow: the background pushed slightly away from the text colour.
  ['--highlight', ['base', 'background'], c => mixColor(c.background, c.base, 1.06)],
  ['--hover', ['accent', 'background'], c => mixColor(c.accent, c.background, 0.12)],
  ['--rail-current', ['accent', 'background'], c => mixColor(c.accent, c.background, 0.16)],
  ['--section', ['accent', 'background'], c => mixColor(c.accent, c.background, 0.14)],
  ['--active', ['accent'], c => c.accent],
  ['--skip', ['background'], c => c.background],
  ['--print-paper', ['background'], c => c.background],
]);
/** CSS variables for the set roles and the hues derived from them; empty when no role is set. */
export function deckPalette(colors = {}) {
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) throw new Error('Deck colors must be an object of base, accent, background');
  for (const [role, value] of Object.entries(colors)) {
    if (!THEME_COLOR_ROLES.includes(role)) throw new Error(`Unsupported deck colour role: ${role}`);
    if (value != null && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) throw new Error(`Deck colour ${role} must be a six-digit hex colour`);
  }
  const set = THEME_COLOR_ROLES.filter(role => colors[role] != null);
  const effective = Object.fromEntries(THEME_COLOR_ROLES.map(role => [role, (colors[role] ?? TEMPLATE_COLORS[role]).toUpperCase()]));
  const palette = Object.fromEntries(set.map(role => [ROLE_VARIABLES[role], effective[role]]));
  for (const [name, roles, derive] of DERIVED_HUES) if (roles.some(role => set.includes(role))) palette[name] = derive(effective);
  return palette;
}

// Bundles built with this runtime report their viewed position when framed (README).
export const DECK_STATE_REPORTING = 1;

/** Bundle assembly reads only packaged fonts/runtime files and supplied media bytes. */
export function buildDeck(input, { assets = {} } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Deck input required');
  const title = text(input.title, 'title');
  const slides = list(input.slides, 'slides');
  if (!slides.length) throw new Error('slides must not be empty');
  const files = new Map();
  const ids = new Set();
  const vectors = new Map(), svgFonts = new Set();
  let instance = 0;
  function asset(path, type) {
    const extensions = type === 'video' ? /\.(mp4|webm)$/i : /\.(svg|png|jpe?g|webp|gif)$/i;
    if (typeof path !== 'string' || !/^assets\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(path) || !extensions.test(path)) throw new Error('Invalid local media path');
    if (!Object.hasOwn(assets, path) || !(assets[path] instanceof Uint8Array) || !assets[path].byteLength) throw new Error(`Missing media bytes: ${path}`);
    if (/\.svg$/i.test(path) || looksLikeSvg(assets[path])) {
      if (type !== 'image' || !/\.svg$/i.test(path)) throw new Error(`SVG media must use an .svg image path: ${path}`);
      try { vectors.set(path, parseSvg(assets[path])); } catch (error) { throw new Error(`Asset ${path}: ${error.message}`); }
    }
    files.set(path, Buffer.from(assets[path]));
    return escape(path);
  }
  function media(value, stages = null) {
    if (!value || !['image', 'video'].includes(value.type)) throw new Error('Media type must be image or video');
    const src = asset(value.src, value.type);
    const alt = text(value.alt, 'media.alt');
    if (stages !== null && !vectors.has(value.src)) throw new Error('Vector composition requires SVG media');
    if (vectors.has(value.src)) {
      const vector = parseSvg(assets[value.src], { namespace: `_sbv${++instance}`, stages });
      for (const family of vector.fonts) svgFonts.add(family);
      // Inline validated geometry can load the bundle's fonts. Retain original editable
      // bytes alongside it; each use gets isolated definitions and presentation styles.
      return `<div class="vector-media" role="img" aria-label="${alt}">${vector.svg}</div>`;
    }
    if (value.type === 'image') return `<img src="${src}" alt="${alt}">`;
    if (value.autoplay !== undefined && typeof value.autoplay !== 'boolean') throw new Error('media.autoplay must be boolean');
    const poster = value.poster ? ` poster="${asset(value.poster, 'image')}"` : '';
    return `<video src="${src}" aria-label="${alt}"${poster} controls muted playsinline preload="metadata" data-autoplay="${value.autoplay === true}"></video>`;
  }
  const rendered = slides.map((slide) => {
    if (!slide || typeof slide.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(slide.id) || ids.has(slide.id)) throw new Error('Slide IDs must be unique safe identifiers');
    ids.add(slide.id);
    if (!layouts.includes(slide.layout)) throw new Error('Unknown layout');
    const heading = text(slide.title, 'slide.title');
    const body = text(slide.body, 'slide.body', true);
    const notes = text(slide.notes, 'slide.notes', true);
    const minutes = slide.targetMinutes ?? 0;
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error('targetMinutes must be nonnegative');
    let content = `<div class="copy"><h1>${heading}</h1><p class="lede">${body}</p></div>`;
    const stages = slide.stages === undefined ? [] : list(slide.stages, 'stages');
    // Timing and motion are validated again here, whatever saved them; refusals name slide and stage.
    const motions = stages.map((stage, i) => {
      try {
        if (!stage || typeof stage !== 'object') throw new Error('must be an object');
        if (!slide.vector) validateTextStage(stage);
        return stageMotion(stage);
      } catch (error) { throw new Error(`Slide ${slide.id}: Stage ${stage?.id ?? i + 1}: ${error.message}`); }
    });
    if (slide.vector) {
      if (slide.media || slide.gallery?.length || !['title', 'text-media', 'full-media', 'process'].includes(slide.layout)) throw new Error(`Slide ${slide.id}: vector requires a supported layout without other media/gallery`);
      try { content += `<figure class="staged-vector">${media(slide.vector, slide.stages ?? [])}</figure>`; }
      catch (error) { throw new Error(`Slide ${slide.id}: ${error.message}`); }
    } else {
      if (slide.stages?.some(stage => stage.svgGroupIds !== undefined)) throw new Error(`Slide ${slide.id}: SVG group mappings require a vector composition`);
      if (['text-media', 'full-media'].includes(slide.layout) && !slide.gallery?.length) content += `<figure>${media(slide.media)}</figure>`;
    }
    if (slide.layout === 'columns') {
      const columns = list(slide.columns, 'columns');
      if (columns.length < 2 || columns.length > 3) throw new Error('columns requires two or three items');
      content += `<div class="columns">${columns.map((col) => `<section><h2>${text(col.title, 'column.title')}</h2><p>${text(col.body, 'column.body')}</p></section>`).join('')}</div>`;
    }
    if (slide.layout === 'process' && !stages.length) throw new Error('process requires stages');
    const subnav = slide.subnav === undefined ? stages.map((stage) => stage.title) : list(slide.subnav, 'subnav');
    if (subnav.length !== stages.length) throw new Error('subnav must label every stage');
    if (stages.length) {
      content += `<div class="stages"${slide.vector ? ' hidden' : ''}>${stages.map((stage, i) => {
        // The runtime reads its timeline from these attributes; an unset field keeps the older behaviour.
        const { afterMs: delay = 0, ...motion } = motions[i];
        return `<section data-step="${i}"${stage.id ? ` data-stage-id="${escape(stage.id)}"` : ''} data-delay="${delay}"${Object.keys(motion).length ? ` data-motion="${escape(JSON.stringify(motion))}"` : ''}><span class="step-number">${i + 1}</span><h2>${text(stage.title, 'stage.title')}</h2><p>${text(stage.body, 'stage.body', true)}</p></section>`;
      }).join('')}</div><nav class="stage-nav" aria-label="Reveal stages">${subnav.map((label, i) => `<button data-stage="${i}">${text(label, 'subnav label')}</button>`).join('')}<button data-command="replay">Replay</button></nav>`;
    }
    if (slide.gallery?.length) content += `<nav class="gallery-nav" aria-label="Gallery">${slide.gallery.map((entry, i) => `<button data-gallery="${i}">${text(entry.label, 'gallery label')}</button>`).join('')}</nav><div class="gallery">${slide.gallery.map((entry, i) => `<figure data-gallery-view="${i}"${i ? ' hidden' : ''}>${entry.media ? media(entry.media) : ''}<figcaption>${text(entry.label, 'gallery label')}</figcaption></figure>`).join('')}</div>`;
    if (slide.caption) content += `<p class="caption">${text(slide.caption,'caption')}</p>`;
    return `<article class="slide layout-${slide.layout}" id="${slide.id}" data-title="${heading}" data-minutes="${minutes}" hidden><header>${text(slide.eyebrow, 'eyebrow', true) || 'Presentation'}<span>${minutes} min</span></header><div class="composition">${content}</div><p class="speaker-notes" hidden>${notes}</p></article>`;
  });
  const shell = (body, script) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="styles.css"><script src="${script}" defer></script></head><body>${body}</body></html>`;
  const buttons = '<button data-command="previous">Previous</button><button data-command="next">Next</button>';
  files.set('index.html', shell(`<a class="skip" href="#presentation">Skip to slides</a><aside class="rail"><strong>${title}</strong><nav aria-label="Slides">${slides.map((slide, i) => `<button data-go="${i}">${String(i + 1).padStart(2, '0')} · ${escape(slide.title)}</button>`).join('')}</nav></aside><main id="presentation" tabindex="-1">${rendered.join('')}</main><footer>${buttons}<output id="counter" aria-live="polite"></output><button id="presenter-open">Presenter (N)</button><button id="fullscreen">Fullscreen</button></footer><p id="status" role="status"></p>`, 'audience.js'));
  files.set('presenter.html', shell(`<main class="presenter"><p id="connection" role="status">Connecting to audience…</p><output id="counter"></output><h1 id="current-title"></h1><p>Next: <span id="next-title"></span></p><label>Slide <select id="slide-select" disabled></select></label><div>${buttons}</div><h2>Speaker notes</h2><p id="notes"></p><label>Stage <select id="stage-select" disabled></select></label><div><button data-command="sub-previous">Previous stage</button><button data-command="sub-next">Next stage</button><button data-command="replay">Replay</button><button data-command="video-toggle">Play / pause</button><button data-command="video-restart">Restart video</button></div><p id="video-status"></p></main>`, 'presenter.js'));
  for (const name of ['audience.js', 'presenter.js', 'styles.css', 'assets/manrope-variable.ttf', 'assets/Manrope-OFL.txt']) files.set(name, readFileSync(new URL(name, import.meta.url)));
  const fontCSS = typography(files, input.fonts, [...svgFonts]);
  const palette = Object.entries(deckPalette(input.colors ?? {}));
  files.set('styles.css', Buffer.from(files.get('styles.css') + '\n.vector-media{width:100%;height:100%;display:flex;align-items:center;justify-content:center}.vector-media>svg{max-width:100%;max-height:60svh;height:auto;font-family:Manrope}\n'));
  if (fontCSS) files.set('styles.css', Buffer.from(files.get('styles.css') + '\n' + fontCSS));
  if (palette.length) files.set('styles.css', Buffer.from(files.get('styles.css') + `\n:root{${palette.map(([name, value]) => `${name}:${value}`).join(';')}}\n`));
  return files;
}
