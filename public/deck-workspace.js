import { icons } from './icons.js';
import { SLIDE_TYPES } from './slide-types.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const layouts = Object.keys(SLIDE_TYPES);
export const newSlide = () => ({ id: `slide_${crypto.randomUUID()}`, title: 'New slide', layout: 'statement', body: '', notes: '', targetMinutes: 1, stages: [], columns: [], subnav: [] });
const iconButton = (action, label, icon, tone = '') => `<button type="button" class="icon-button ${tone}" data-slide-action="${action}" aria-label="${label}" title="${label}">${icons[icon]}</button>`;
const stageFields = ['trigger', 'afterMs', 'durationMs', 'holdMs', 'easing', 'motion'];
const partName = { columns: 'column', stages: 'reveal stage', subnav: 'navigation entry' };
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
export const slideNumber = index => String(index + 1).padStart(2, '0');

// ---- Slide list (spec #46, Slide List): one collapsed card per slide; one open at a time.

// What the slide card warns about. `items` is the production's library, or null while it loads.
export function slideWarnings(slide, items) {
  const warnings = [];
  const picked = [slide.media?.itemId, slide.vector?.itemId, ...(slide.subnav || []).map(view => view.itemId)].filter(Boolean);
  if (items && picked.some(id => !items.some(item => item.id === id))) warnings.push('Missing media');
  if (slide.vector) {
    const parts = items?.find(item => item.id === slide.vector.itemId)?.asset?.metadata?.svgGroupIds;
    if (parts && (slide.stages || []).some(stage => !(stage.svgGroupIds || []).some(id => parts.includes(id)))) warnings.push('A step reveals nothing');
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

// ---- Slide fields (the editor's Elements panel): only the slots the slide's type has (spec #46, Slide
// Types). Values the type has no slot for stay saved and hidden; the panel says how many.

// The saved values the slide's type does not show, by plain name.
export function hiddenValues(slide) {
  const type = SLIDE_TYPES[slide.layout];
  if (!type) return [];
  const hidden = [];
  if (slide.media && !type.visual.some(kind => kind === 'image' || kind === 'video')) hidden.push('media');
  if (slide.vector && !type.visual.includes('drawing')) hidden.push('drawing');
  if (slide.subnav?.length && !type.visual.includes('gallery')) hidden.push('gallery');
  if (slide.columns?.length && !type.columns) hidden.push('columns');
  return hidden;
}
// The slots the panel shows for a slide's type: copy, media, drawing, gallery, columns, steps.
export function slideSlots(layout) {
  const type = SLIDE_TYPES[layout] || SLIDE_TYPES.statement;
  return ['copy', ...(type.visual.some(kind => kind === 'image' || kind === 'video') ? ['media'] : []), ...(type.visual.includes('drawing') ? ['drawing'] : []),
    ...(type.visual.includes('gallery') ? ['gallery'] : []), ...(type.columns ? ['columns'] : []), 'steps'];
}
export function slideFieldsHTML(slide, index, items, sections) {
  items ||= [];
  const labels = { title: 'Title', eyebrow: 'Header label', body: 'Body', notes: 'Speaker notes', targetMinutes: 'Target duration (minutes)', mediaAlt: 'Media description', caption: 'Caption', vectorAlt: 'Drawing description', label: 'Label', afterMs: 'Delay before this stage (ms)', durationMs: 'Motion duration (ms)', holdMs: 'Hold after motion (ms)' };
  const field = (key, value, type = 'text') => `<label>${esc(labels[key] || key)}${type === 'textarea' ? `<textarea data-slide-field="${key}">${esc(value)}</textarea>` : `<input data-slide-field="${key}" type="${type}" ${type === 'number' ? 'min="0" step="any"' : ''} value="${esc(value)}">`}</label>`;
  const options = (values, selected) => values.map(([id, label]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const vectorGroups = slide => items.find(item => item.id === slide.vector?.itemId)?.asset?.metadata?.svgGroupIds || [];
  const groupField = (slide, part) => `<label>SVG groups for this stage<select multiple data-slide-field="svgGroupIds">${vectorGroups(slide).map(id => `<option value="${esc(id)}" ${(part.svgGroupIds || []).includes(id) ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select></label>`;
  // Timing and motion of one reveal stage. An empty choice leaves the field unset, which keeps the standard behaviour.
  const choice = (key, label, part, values) => `<label>${label}<select data-slide-field="${key}">${options(values, values.some(([id]) => id === part[key]) ? part[key] : '')}</select></label>`;
  const stageMotion = (slide, part) => `<div class="stage-motion">
    ${choice('trigger', 'Starts', part, [['', 'Automatically when a delay is set'], ['auto', 'Automatically'], ['manual', 'On click']])}
    ${field('afterMs', part.afterMs ?? '', 'number')}${field('durationMs', part.durationMs ?? '', 'number')}${field('holdMs', part.holdMs ?? '', 'number')}
    ${choice('easing', 'Easing', part, [['', 'Standard'], ['linear', 'Linear'], ['ease-in', 'Ease in'], ['ease-out', 'Ease out'], ['ease-in-out', 'Ease in and out']])}
    ${choice('motion', 'Motion', part, [[part.motion === 'fade' ? 'fade' : '', 'Fade'], ...(slide.vector || ['draw', 'enter'].includes(part.motion) ? [['draw', 'Draw strokes'], ['enter', 'Enter from a start state']] : [])])}
    </div>${part.from || part.changes?.length ? `<p class="stage-motion-note" data-stage-changes="${part.changes?.length || 0}">${[part.changes?.length ? `Moves ${count(part.changes.length, 'group')} already on the slide (${count(part.changes.length, 'change')})` : '', part.from ? 'Has a starting state' : ''].filter(Boolean).join('. ')}. Edit these through chat.</p>` : ''}`;
  const mediaItems = items.filter(i => ['image','video'].includes(i.asset?.kind)).map(i => [i.id,i.label]);
  const parts = key => `<section class="deck-parts" data-slot="${{ subnav: 'gallery', stages: 'steps' }[key] || key}"><h3>${key === 'stages' ? 'Steps' : key === 'subnav' ? 'Gallery / demo navigation' : 'Columns'}</h3>${(slide[key] || []).map((part, partIndex) => `<div data-part="${key}" data-part-index="${partIndex}">${key === 'subnav' ? field('label', part.label) + `<label>Gallery media<select data-slide-field="itemId">${options([['','No media'], ...mediaItems], part.itemId || '')}</select></label>` : field('title',part.title) + field('body',part.body,'textarea')}${key === 'stages' ? stageMotion(slide, part) + (slide.vector ? groupField(slide, part) : '') : ''}<div class="icon-actions">${iconButton('part-up', `Move ${partName[key]} up`, 'up')}${iconButton('part-down', `Move ${partName[key]} down`, 'down')}${iconButton('part-delete', `Remove ${partName[key]}`, 'trash', 'danger')}</div></div>`).join('')}<button type="button" data-slide-action="add-${key}">Add ${key === 'stages' ? 'reveal stage' : key === 'subnav' ? 'navigation entry' : 'column'}</button></section>`;
  const slots = {
    copy: () => `<section class="deck-slot" data-slot="copy"><h3>Title and text</h3>${field('title', slide.title)}${field('eyebrow', slide.eyebrow)}${field('body', slide.body, 'textarea')}${field('caption', slide.caption)}</section>`,
    media: () => `<section class="deck-slot" data-slot="media"><h3>Media</h3><label>Media<select data-slide-field="mediaItemId">${options([['','No media'], ...mediaItems], slide.media?.itemId || '')}</select></label>
      ${slide.media && !items.some(i => i.id === slide.media.itemId) ? '<p role="alert">Missing media: choose an available item from the library.</p>' : ''}${field('mediaAlt', slide.media?.alt)}</section>`,
    drawing: () => `<section class="deck-slot" data-slot="drawing"><h3>Drawing</h3><label>Staged SVG<select data-slide-field="vectorItemId">${options([['','No staged vector'], ...items.filter(i => i.asset?.metadata?.contentType === 'image/svg+xml').map(i => [i.id,i.label])], slide.vector?.itemId || '')}</select></label>
      ${slide.vector ? field('vectorAlt', slide.vector.alt) + '<p>A drawing needs no ordinary media or gallery views. Select groups for each step below; groups without a mapping stay visible. Use Ctrl/Command to select multiple groups.</p>' : ''}</section>`,
    gallery: () => parts('subnav'),
    columns: () => parts('columns'),
    steps: () => parts('stages'),
  };
  const hidden = hiddenValues(slide);
  return `<div class="deck-slide" data-slide-index="${index}">
    ${hidden.length ? `<p class="deck-hidden-values" data-hidden-count="${hidden.length}">${count(hidden.length, 'saved value')} hidden by this layout (${hidden.join(', ')}). They are kept; choose a layout that shows them to edit them.</p>` : ''}
    ${slideSlots(slide.layout).map(slot => slots[slot]()).join('')}
    <section class="deck-slot" data-slot="more"><h3>More</h3>${field('notes', slide.notes, 'textarea')}${field('targetMinutes', slide.targetMinutes, 'number')}
    <label>Story section<select data-slide-field="sectionId">${options([['','Unassigned'], ...(sections || []).map(s => [s.id,s.title])], slide.sectionId || '')}</select></label></section>
  </div>`;
}
// The layout choice for the editor header, by plain name; a saved layout outside the declaration still shows.
export const layoutOptions = selected => [...layouts, ...(layouts.includes(selected) ? [] : [selected])]
  .map(id => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(SLIDE_TYPES[id]?.label || id)}</option>`).join('');
// Field edits inside `root` change the slide under the nearest [data-slide-index]. Typing marks the
// production dirty; a committed change saves. Changing layout or vector re-renders the slots at once.
export function bindSlideFields(root, { getSlides, onDirty, onSave, render }) {
  root.addEventListener('input', event => {
    const field = event.target.dataset.slideField;
    if (!field) return;
    const slide = getSlides()[Number(event.target.closest('[data-slide-index]').dataset.slideIndex)];
    const part = event.target.closest('[data-part]');
    const target = part ? slide[part.dataset.part][Number(part.dataset.partIndex)] : slide;
    const value = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
    // An emptied stage timing or motion field is unset, not zero: unset keeps the standard behaviour.
    if (stageFields.includes(field) && event.target.value === '') delete target[field];
    else if (field === 'svgGroupIds') target.svgGroupIds = [...event.target.selectedOptions].map(option => option.value);
    else if (field === 'layout') { target.layout = value; onDirty(); render(); onSave(); return; }
    else if (field === 'vectorItemId') {
      target.vector = value ? { itemId: value, alt: target.vector?.alt || '' } : null;
      // Without its vector the slide is text: drop what only SVG groups can carry, keep the timing.
      if (!value) for (const stage of target.stages || []) {
        delete stage.svgGroupIds; delete stage.changes; delete stage.from;
        if (['draw', 'enter'].includes(stage.motion)) delete stage.motion;
      }
      onDirty(); render(); onSave(); return;
    }
    else if (field === 'vectorAlt') { if (target.vector) target.vector.alt = value; }
    else if (field === 'mediaItemId') target.media = value ? { itemId: value, alt: target.media?.alt || '' } : null;
    else if (field === 'mediaAlt') { if (target.media) target.media.alt = value; }
    else target[field] = value;
    onDirty();
  });
  root.addEventListener('change', event => { if (event.target.dataset.slideField && !['layout', 'vectorItemId'].includes(event.target.dataset.slideField)) onSave(); });
  root.addEventListener('click', event => {
    const action = event.target.closest('[data-slide-action]')?.dataset.slideAction;
    if (!action || !(action.startsWith('add-') || action.startsWith('part-'))) return;
    const slide = getSlides()[Number(event.target.closest('[data-slide-index]').dataset.slideIndex)];
    if (action.startsWith('add-')) {
      const key = action.slice(4); (slide[key] ||= []).push(key === 'subnav' ? {id: `nav_${crypto.randomUUID()}`, label: 'New view'} : { ...(key === 'stages' ? {id: `stage_${crypto.randomUUID()}`} : {}), title: 'New item', body: '' });
    } else {
      const row = event.target.closest('[data-part]'), values = slide[row.dataset.part], from = Number(row.dataset.partIndex);
      if (action === 'part-delete') values.splice(from, 1); else move(values, from, from + (action === 'part-up' ? -1 : 1));
    }
    onDirty(); render(); onSave();
  });
}
