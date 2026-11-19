import { icons } from './icons.js';
import { SLIDE_TYPES } from './slide-types.js';
import { missingParts, missingPartText } from './deck-library.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const layouts = Object.keys(SLIDE_TYPES);
export const newSlide = () => ({ id: `slide_${crypto.randomUUID()}`, title: 'New slide', layout: 'statement', body: '', notes: '', targetMinutes: 1, stages: [], columns: [], subnav: [] });
const iconButton = (action, label, icon, tone = '') => `<button type="button" class="icon-button ${tone}" data-slide-action="${action}" aria-label="${label}" title="${label}">${icons[icon]}</button>`;
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
export const slideNumber = index => String(index + 1).padStart(2, '0');

// ---- Slide list (spec #46, Slide List): one collapsed card per slide; one open at a time.

// What the slide card warns about. `items` is the production's library, or null while it loads.
export function slideWarnings(slide, items) {
  const warnings = [];
  const picked = [slide.media?.itemId, slide.vector?.itemId, ...(slide.subnav || []).map(view => view.itemId)].filter(Boolean);
  if (items && picked.some(id => !items.some(item => item.id === id))) warnings.push('Missing media');
  if (slide.vector) {
    const drawing = items?.find(item => item.id === slide.vector.itemId), missing = missingParts(drawing, slide.stages);
    if (missing.length) warnings.push(missingPartText(drawing, missing[0]));
  }
  if (slide.candidates?.length && !picked.length) warnings.push('No pick for the visual');
  return warnings;
}
function slidePills(slide, items) {
  const pills = [SLIDE_TYPES[slide.layout]?.label || slide.layout];
  if (slide.vector) pills.push('Drawing');
  if (slide.stages?.length) pills.push(count(slide.stages.length, 'step'));
  const candidates = new Set([slide.media?.itemId, slide.vector?.itemId, ...(slide.subnav || []).map(view => view.itemId), ...(slide.candidates || []).map(c => c.itemId)].filter(Boolean)).size;
  if (candidates) pills.push(count(candidates, 'candidate'));
  const warnings = slideWarnings(slide, items);
  return pills.map(text => `<span class="slide-pill">${esc(text)}</span>`).join('')
    + (warnings.length ? `<span class="slide-pill warn" data-slide-warning title="${esc(warnings.join('. '))}">${esc(warnings[0])}${warnings.length > 1 ? ` +${warnings.length - 1}` : ''}</span>` : '');
}
// The card's description line: the body's first line (spec #46: no separate field).
const firstLine = body => String(body || '').split('\n').map(line => line.trim()).find(Boolean) || '';
export function slideListHTML(slides, items, openId) {
  return slides.map((slide, index) => {
    const open = slide.id === openId, number = slideNumber(index), description = firstLine(slide.body);
    return `<article class="slide-card${open ? ' is-open' : ''}" data-slide-index="${index}" data-slide-id="${esc(slide.id)}">
    <div class="slide-card-head" data-slide-toggle>
      <span class="slide-grip" data-slide-grip draggable="true" title="Drag to reorder" aria-hidden="true">${icons.grip}</span>
      <span class="slide-number">${number}</span>
      <button type="button" class="slide-card-summary" data-slide-toggle aria-expanded="${open}" aria-label="Slide ${number}: ${esc(slide.title)}"><strong>${esc(slide.title)}</strong><span class="${description ? '' : 'is-empty'}">${esc(description || 'No body text')}</span></button>
      <div class="slide-pills">${slidePills(slide, items)}</div>
      <div class="slide-card-actions">${iconButton('play', `Play slide ${number}`, 'play')}${iconButton('up', 'Move slide up', 'up')}${iconButton('down', 'Move slide down', 'down')}${iconButton('duplicate', 'Duplicate slide', 'copy')}${iconButton('delete', 'Delete slide', 'trash', 'danger')}</div>
    </div>
    ${open ? `<div class="slide-card-body">
      <div class="slide-inline" data-slide-edit role="button" tabindex="0" aria-label="Edit slide ${number}" title="Open the slide editor"><div class="slide-inline-viewport" data-slide-preview></div></div>
      <p class="slide-inline-status" role="status" data-slide-preview-status></p>
      <div class="slide-card-foot"><span>${slide.stages?.length ? `${count(slide.stages.length, 'step')} · ${slide.stages.filter(stage => stage.trigger === 'manual').length} on click` : 'No steps'} · ${esc(slide.targetMinutes ?? 1)} min</span>
        <button type="button" data-slide-action="play">${icons.play} Play</button><button type="button" data-slide-action="edit">${icons.edit} Edit slide</button></div>
    </div>` : ''}
  </article>`;
  }).join('') || '<div class="workspace-empty"><h3>Your deck starts with a slide</h3><p>Use Add slide above to begin. Story and chat remain available while you compose.</p></div>';
}
const move = (values, from, to) => { if (from !== to && to >= 0 && to < values.length) values.splice(to, 0, ...values.splice(from, 1)); };
function duplicate(slides, index) {
  const copy = structuredClone(slides[index]); copy.id = newSlide().id; copy.title += ' (copy)';
  for (const key of ['stages', 'subnav']) for (const part of copy[key] || []) part.id = `part_${crypto.randomUUID()}`;
  slides.splice(index + 1, 0, copy);
}
// Header click opens or closes a card; hover actions, the grip and the inline slide act on that slide.
// Every change to the slides is one save through the normal revision check (`onChange`).
export function bindSlideList(root, { getSlides, getOpenId, setOpenId, onPlay, onEdit, onChange, confirm = message => window.confirm(message) }) {
  const indexOf = target => Number(target.closest('[data-slide-index]')?.dataset.slideIndex);
  root.addEventListener('click', event => {
    const card = event.target.closest('[data-slide-index]');
    if (!card) return;
    const slides = getSlides(), index = indexOf(card), slide = slides[index];
    const action = event.target.closest('[data-slide-action]')?.dataset.slideAction;
    if (action === 'play') return onPlay(slide.id);
    if (action === 'edit' || event.target.closest('[data-slide-edit]')) return onEdit(slide.id);
    if (action === 'up' || action === 'down') { move(slides, index, index + (action === 'up' ? -1 : 1)); return onChange(); }
    if (action === 'duplicate') { duplicate(slides, index); return onChange(); }
    if (action === 'delete') {
      if (!confirm(`Delete slide ${slideNumber(index)} “${slide.title}”? This cannot be undone.`)) return;
      slides.splice(index, 1); return onChange();
    }
    if (event.target.closest('[data-slide-grip]') || event.target.closest('.slide-card-actions') || !event.target.closest('[data-slide-toggle]')) return;
    setOpenId(getOpenId() === slide.id ? null : slide.id);
  });
  root.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || !event.target.matches('[data-slide-edit]')) return;
    event.preventDefault(); onEdit(getSlides()[indexOf(event.target)].id);
  });
  // Drag by the grip; the card under the pointer shows where the slide lands (before or after it).
  let dragged = null;
  const clear = () => root.querySelectorAll('[data-drop]').forEach(node => node.removeAttribute('data-drop'));
  const target = event => {
    const card = event.target.closest?.('[data-slide-index]');
    if (!card || dragged === null) return null;
    const box = card.getBoundingClientRect(), after = event.clientY > box.top + box.height / 2;
    return { card, after, to: indexOf(card) + (after ? 1 : 0) };
  };
  root.addEventListener('dragstart', event => {
    const card = event.target.closest?.('[data-slide-grip]')?.closest('[data-slide-index]');
    if (!card) return;
    dragged = indexOf(card);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/storybench-slide', card.dataset.slideId);
    event.dataTransfer.setDragImage(card, 20, 20);
    card.classList.add('is-dragging');
  });
  root.addEventListener('dragover', event => {
    const at = target(event);
    if (!at) return;
    event.preventDefault(); clear();
    at.card.dataset.drop = at.after ? 'after' : 'before';
  });
  root.addEventListener('drop', event => {
    const at = target(event), from = dragged;
    if (!at) return;
    event.preventDefault();
    const to = at.to > from ? at.to - 1 : at.to;
    if (to === from) return;
    move(getSlides(), from, to); onChange();
  });
  root.addEventListener('dragend', () => { dragged = null; clear(); root.querySelectorAll('.is-dragging').forEach(node => node.classList.remove('is-dragging')); });
}

// The layout choice for the editor header, by plain name; a saved layout outside the declaration still shows.
export const layoutOptions = selected => [...layouts, ...(layouts.includes(selected) ? [] : [selected])]
  .map(id => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(SLIDE_TYPES[id]?.label || id)}</option>`).join('');
