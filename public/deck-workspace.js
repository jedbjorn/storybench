import { icons } from './icons.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const layouts = ['title', 'section', 'statement', 'text-media', 'columns', 'full-media', 'process'];
export const newSlide = () => ({ id: `slide_${crypto.randomUUID()}`, title: 'New slide', layout: 'statement', body: '', notes: '', targetMinutes: 1, stages: [], columns: [], subnav: [] });
const iconButton = (action, label, icon, tone = '') => `<button type="button" class="icon-button ${tone}" data-slide-action="${action}" aria-label="${label}" title="${label}">${icons[icon]}</button>`;
const stageFields = ['trigger', 'afterMs', 'durationMs', 'holdMs', 'easing', 'motion'];
const partName = { columns: 'column', stages: 'reveal stage', subnav: 'navigation entry' };
export function deckBoardHTML(slides, items, sections) {
  const labels = { title: 'Title', eyebrow: 'Eyebrow', body: 'Body', notes: 'Speaker notes', targetMinutes: 'Target duration (minutes)', mediaAlt: 'Media description', caption: 'Caption', vectorAlt: 'Vector description', label: 'Label', afterMs: 'Delay before this stage (ms)', durationMs: 'Motion duration (ms)', holdMs: 'Hold after motion (ms)' };
  const field = (key, value, type = 'text') => `<label>${esc(labels[key] || key)}${type === 'textarea' ? `<textarea data-slide-field="${key}">${esc(value)}</textarea>` : `<input data-slide-field="${key}" type="${type}" ${type === 'number' ? 'min="0" step="any"' : ''} value="${esc(value)}">`}</label>`;
  const options = (values, selected) => values.map(([id, label]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const vectorGroups = slide => items.find(item => item.id === slide.vector?.itemId)?.asset?.metadata?.svgGroupIds || [];
  const groupField = (slide, part) => `<label>SVG groups for this stage<select multiple data-slide-field="svgGroupIds">${vectorGroups(slide).map(id => `<option value="${esc(id)}" ${(part.svgGroupIds || []).includes(id) ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select></label>`;
  // Timing and motion of one reveal stage. An empty choice leaves the field unset, which keeps the standard behaviour.
  const choice = (key, label, part, values) => `<label>${label}<select data-slide-field="${key}">${options(values, values.some(([id]) => id === part[key]) ? part[key] : '')}</select></label>`;
  const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const stageMotion = (slide, part) => `<div class="stage-motion">
    ${choice('trigger', 'Starts', part, [['', 'Automatically when a delay is set'], ['auto', 'Automatically'], ['manual', 'On click']])}
    ${field('afterMs', part.afterMs ?? '', 'number')}${field('durationMs', part.durationMs ?? '', 'number')}${field('holdMs', part.holdMs ?? '', 'number')}
    ${choice('easing', 'Easing', part, [['', 'Standard'], ['linear', 'Linear'], ['ease-in', 'Ease in'], ['ease-out', 'Ease out'], ['ease-in-out', 'Ease in and out']])}
    ${choice('motion', 'Motion', part, [[part.motion === 'fade' ? 'fade' : '', 'Fade'], ...(slide.vector || ['draw', 'enter'].includes(part.motion) ? [['draw', 'Draw strokes'], ['enter', 'Enter from a start state']] : [])])}
    </div>${part.from || part.changes?.length ? `<p class="stage-motion-note" data-stage-changes="${part.changes?.length || 0}">${[part.changes?.length ? `Moves ${count(part.changes.length, 'group')} already on the slide (${count(part.changes.length, 'change')})` : '', part.from ? 'Has a starting state' : ''].filter(Boolean).join('. ')}. Edit these through chat.</p>` : ''}`;
  return slides.map((slide, index) => `<article class="deck-slide" data-slide-index="${index}">
    <header><strong>${index + 1}. ${esc(slide.title)}</strong><div class="icon-actions">${iconButton('up', 'Move slide up', 'up')}${iconButton('down', 'Move slide down', 'down')}${iconButton('duplicate', 'Duplicate slide', 'copy')}${iconButton('delete', 'Delete slide', 'trash', 'danger')}</div></header>
    ${field('title', slide.title)}<label>Layout<select data-slide-field="layout">${options(layouts.map(v => [v,v]), slide.layout)}</select></label>
    ${field('eyebrow', slide.eyebrow)}${field('body', slide.body, 'textarea')}${field('notes', slide.notes, 'textarea')}${field('targetMinutes', slide.targetMinutes, 'number')}
    <label>Story section<select data-slide-field="sectionId">${options([['','Unassigned'], ...sections.map(s => [s.id,s.title])], slide.sectionId || '')}</select></label>
    <label>Media<select data-slide-field="mediaItemId">${options([['','No media'], ...items.filter(i => ['image','video'].includes(i.asset?.kind)).map(i => [i.id,i.label])], slide.media?.itemId || '')}</select></label>
    ${slide.media && !items.some(i => i.id === slide.media.itemId) ? '<p role="alert">Missing media: choose an available item from the library.</p>' : ''}
    <label>Staged SVG<select data-slide-field="vectorItemId">${options([['','No staged vector'], ...items.filter(i => i.asset?.metadata?.contentType === 'image/svg+xml').map(i => [i.id,i.label])], slide.vector?.itemId || '')}</select></label>
    ${slide.vector ? field('vectorAlt', slide.vector.alt) + '<p>Use title, text-media, full-media or process layout with no ordinary media or gallery views. Select groups for each reveal below. Groups without a mapping stay visible. Use Ctrl/Command to select multiple groups.</p>' : ''}
    ${field('mediaAlt', slide.media?.alt)}${field('caption', slide.caption)}
    ${['columns','stages','subnav'].map(key => `<section class="deck-parts"><h3>${key === 'stages' ? 'Reveal stages' : key === 'subnav' ? 'Gallery / demo navigation' : 'Columns'}</h3>${(slide[key] || []).map((part, partIndex) => `<div data-part="${key}" data-part-index="${partIndex}">${key === 'subnav' ? field('label', part.label) + `<label>Gallery media<select data-slide-field="itemId">${options([['','No media'], ...items.filter(i => ['image','video'].includes(i.asset?.kind)).map(i => [i.id,i.label])], part.itemId || '')}</select></label>` : field('title',part.title) + field('body',part.body,'textarea')}${key === 'stages' ? stageMotion(slide, part) + (slide.vector ? groupField(slide, part) : '') : ''}<div class="icon-actions">${iconButton('part-up', `Move ${partName[key]} up`, 'up')}${iconButton('part-down', `Move ${partName[key]} down`, 'down')}${iconButton('part-delete', `Remove ${partName[key]}`, 'trash', 'danger')}</div></div>`).join('')}<button data-slide-action="add-${key}">Add ${key === 'stages' ? 'reveal stage' : key === 'subnav' ? 'navigation entry' : 'column'}</button></section>`).join('')}
  </article>`).join('') || '<div class="workspace-empty"><h3>Your deck starts with a slide</h3><p>Use Add slide above to begin. Story and chat remain available while you compose.</p></div>';
}
export function bindDeckBoard(root, { getSlides, onDirty, onSave, render }) {
  root.oninput = event => {
    const field = event.target.dataset.slideField;
    if (!field) return;
    const slide = getSlides()[Number(event.target.closest('[data-slide-index]').dataset.slideIndex)];
    const part = event.target.closest('[data-part]');
    const target = part ? slide[part.dataset.part][Number(part.dataset.partIndex)] : slide;
    const value = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
    // An emptied stage timing or motion field is unset, not zero: unset keeps the standard behaviour.
    if (stageFields.includes(field) && event.target.value === '') delete target[field];
    else if (field === 'svgGroupIds') target.svgGroupIds = [...event.target.selectedOptions].map(option => option.value);
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
  };
  root.onchange = () => onSave();
  root.onclick = event => {
    const action = event.target.closest('[data-slide-action]')?.dataset.slideAction;
    if (!action) return;
    const slides = getSlides(), index = Number(event.target.closest('[data-slide-index]').dataset.slideIndex), slide = slides[index];
    const move = (values, from, delta) => { const to = from + delta; if (to >= 0 && to < values.length) [values[from],values[to]] = [values[to],values[from]]; };
    if (action === 'up' || action === 'down') move(slides,index,action === 'up' ? -1 : 1);
    if (action === 'delete') slides.splice(index,1);
    if (action === 'duplicate') {
      const copy = structuredClone(slide); copy.id = newSlide().id; copy.title += ' (copy)';
      for (const key of ['stages','subnav']) for (const part of copy[key] || []) part.id = `part_${crypto.randomUUID()}`;
      slides.splice(index + 1,0,copy);
    }
    if (action.startsWith('add-')) {
      const key = action.slice(4); (slide[key] ||= []).push(key === 'subnav' ? {id: `nav_${crypto.randomUUID()}`, label: 'New view'} : { ...(key === 'stages' ? {id: `stage_${crypto.randomUUID()}`} : {}), title: 'New item', body: '' });
    }
    if (action.startsWith('part-')) {
      const row = event.target.closest('[data-part]'), values = slide[row.dataset.part], from = Number(row.dataset.partIndex);
      if (action === 'part-delete') values.splice(from,1); else move(values,from,action === 'part-up' ? -1 : 1);
    }
    onDirty(); render(); onSave();
  };
}
