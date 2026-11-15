const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const layouts = ['title', 'section', 'statement', 'text-media', 'columns', 'full-media', 'process'];
export const newSlide = () => ({ id: `slide_${crypto.randomUUID()}`, title: 'New slide', layout: 'statement', body: '', notes: '', targetMinutes: 1, stages: [], columns: [], subnav: [] });
export function deckBoardHTML(slides, items, sections) {
  const labels = { title: 'Title', eyebrow: 'Eyebrow', body: 'Body', notes: 'Speaker notes', targetMinutes: 'Target duration (minutes)', mediaAlt: 'Media description', caption: 'Caption', vectorAlt: 'Vector description', label: 'Label', afterMs: 'Reveal delay (ms)' };
  const field = (key, value, type = 'text') => `<label>${esc(labels[key] || key)}${type === 'textarea' ? `<textarea data-slide-field="${key}">${esc(value)}</textarea>` : `<input data-slide-field="${key}" type="${type}" ${type === 'number' ? 'min="0" step="any"' : ''} value="${esc(value)}">`}</label>`;
  const options = (values, selected) => values.map(([id, label]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const vectorGroups = slide => items.find(item => item.id === slide.vector?.itemId)?.asset?.metadata?.svgGroupIds || [];
  const groupField = (slide, part) => `<label>SVG groups for this stage<select multiple data-slide-field="svgGroupIds">${vectorGroups(slide).map(id => `<option value="${esc(id)}" ${(part.svgGroupIds || []).includes(id) ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select></label>`;
  return slides.map((slide, index) => `<article class="deck-slide" data-slide-index="${index}">
    <header><strong>${index + 1}. ${esc(slide.title)}</strong><div><button data-slide-action="up" aria-label="Move slide up">↑</button><button data-slide-action="down" aria-label="Move slide down">↓</button><button data-slide-action="duplicate">Duplicate</button><button data-slide-action="delete">Delete slide</button></div></header>
    ${field('title', slide.title)}<label>Layout<select data-slide-field="layout">${options(layouts.map(v => [v,v]), slide.layout)}</select></label>
    ${field('eyebrow', slide.eyebrow)}${field('body', slide.body, 'textarea')}${field('notes', slide.notes, 'textarea')}${field('targetMinutes', slide.targetMinutes, 'number')}
    <label>Story section<select data-slide-field="sectionId">${options([['','Unassigned'], ...sections.map(s => [s.id,s.title])], slide.sectionId || '')}</select></label>
    <label>Media<select data-slide-field="mediaItemId">${options([['','No media'], ...items.filter(i => ['image','video'].includes(i.asset?.kind)).map(i => [i.id,i.label])], slide.media?.itemId || '')}</select></label>
    ${slide.media && !items.some(i => i.id === slide.media.itemId) ? '<p role="alert">Missing media: choose an available item from the library.</p>' : ''}
    <label>Staged SVG<select data-slide-field="vectorItemId">${options([['','No staged vector'], ...items.filter(i => i.asset?.metadata?.contentType === 'image/svg+xml').map(i => [i.id,i.label])], slide.vector?.itemId || '')}</select></label>
    ${slide.vector ? field('vectorAlt', slide.vector.alt) + '<p>Use title, text-media, full-media or process layout with no ordinary media or gallery views. Select groups for each reveal below. Groups without a mapping stay visible. Use Ctrl/Command to select multiple groups.</p>' : ''}
    ${field('mediaAlt', slide.media?.alt)}${field('caption', slide.caption)}
    ${['columns','stages','subnav'].map(key => `<section class="deck-parts"><h3>${key === 'stages' ? 'Reveal stages' : key === 'subnav' ? 'Gallery / demo navigation' : 'Columns'}</h3>${(slide[key] || []).map((part, partIndex) => `<div data-part="${key}" data-part-index="${partIndex}">${key === 'subnav' ? field('label', part.label) + `<label>Gallery media<select data-slide-field="itemId">${options([['','No media'], ...items.filter(i => ['image','video'].includes(i.asset?.kind)).map(i => [i.id,i.label])], part.itemId || '')}</select></label>` : field('title',part.title) + field('body',part.body,'textarea')}${key === 'stages' ? field('afterMs',part.afterMs ?? '', 'number') + (slide.vector ? groupField(slide, part) : '') : ''}<button data-slide-action="part-up">↑</button><button data-slide-action="part-down">↓</button><button data-slide-action="part-delete">Remove</button></div>`).join('')}<button data-slide-action="add-${key}">Add ${key === 'stages' ? 'reveal stage' : key === 'subnav' ? 'navigation entry' : 'column'}</button></section>`).join('')}
  </article>`).join('') || '<div class="workspace-empty"><h3>Your deck starts with a slide</h3><p>Use Add slide above to begin. Story and chat remain available while you compose.</p></div>';
}
export function bindDeckBoard(root, { getSlides, onDirty, onSave, render }) {
  root.oninput = event => {
    const field = event.target.dataset.slideField;
    if (!field) return;
    const slide = getSlides()[Number(event.target.closest('[data-slide-index]').dataset.slideIndex)];
    const part = event.target.closest('[data-part]');
    const target = part ? slide[part.dataset.part][Number(part.dataset.partIndex)] : slide;
    const value = event.target.type === 'number' ? (event.target.value === '' && field === 'afterMs' ? undefined : Number(event.target.value)) : event.target.value;
    if (field === 'svgGroupIds') target.svgGroupIds = [...event.target.selectedOptions].map(option => option.value);
    else if (field === 'vectorItemId') {
      target.vector = value ? { itemId: value, alt: target.vector?.alt || '' } : null;
      if (!value) for (const stage of target.stages || []) delete stage.svgGroupIds;
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
