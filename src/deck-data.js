// Saved composition data, shared by manual editing and runtime tools. No executable markup.
export const DECK_LAYOUTS = ['title', 'section', 'statement', 'text-media', 'columns', 'full-media', 'process'];
export function validateSlides(slides, { libraryItems = [], sections = [] } = {}) {
  const fail = (message) => { throw new Error(message); };
  const text = (value, name, required = false) => {
    if (typeof value !== 'string' || (required && !value.trim())) fail(`${name} must be ${required ? 'nonempty ' : ''}text`);
    return value;
  };
  const timing = (value, name) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`${name} must be finite and nonnegative`);
    return value;
  };
  const ids = (values, name) => {
    const seen = new Set();
    for (const value of values) {
      text(value.id, `${name} id`, true);
      if (seen.has(value.id)) fail(`Duplicate ${name} id: ${value.id}`);
      seen.add(value.id);
    }
  };
  if (!Array.isArray(slides)) fail('slides must be an array');
  if (slides.some(s => !s || typeof s !== 'object')) fail('Each slide must be an object');
  ids(slides, 'slide');
  return slides.map((slide) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(slide.id)) fail("Slide IDs must be safe identifiers");
    if (!DECK_LAYOUTS.includes(slide.layout)) fail(`Unknown layout on slide ${slide.id}`);
    const result = { id: slide.id, title: text(slide.title, 'Slide title', true), layout: slide.layout,
      body: text(slide.body ?? '', 'body'), notes: text(slide.notes ?? '', 'notes'),
      eyebrow: text(slide.eyebrow ?? '', 'eyebrow'), caption: text(slide.caption ?? '', 'caption'),
      targetMinutes: timing(slide.targetMinutes ?? 0, 'targetMinutes'), sectionId: slide.sectionId || null,
      referenceItemIds: [], stages: [], subnav: [], columns: [], media: null };
    if (result.sectionId && !sections.some(s => s.id === result.sectionId)) fail(`Story section not found: ${result.sectionId}`);
    const item = (itemId) => {
      const value = libraryItems.find(i => i.id === itemId);
      if (!value) fail(`Slide ${slide.id}: library item not found: ${itemId}`);
      return value;
    };
    if (!Array.isArray(slide.referenceItemIds ?? [])) fail('referenceItemIds must be an array');
    result.referenceItemIds = (slide.referenceItemIds ?? []).map(id => { item(id); return id; });
    if (slide.media) {
      const selected = item(slide.media.itemId);
      if (!['image', 'video'].includes(selected.asset?.kind)) fail(`Slide ${slide.id}: media must be image or video`);
      result.media = { itemId: selected.id, alt: text(slide.media.alt ?? '', 'media alt') };
    }
    for (const key of ['columns', 'stages', 'subnav']) {
      const values = slide[key] ?? [];
      if (!Array.isArray(values) || values.some(v => !v || typeof v !== 'object')) fail(`${key} must be an array of objects`);
      if (key !== 'columns') ids(values, key);
      result[key] = values.map(value => key === 'subnav'
        ? { id: value.id, label: text(value.label, 'Sub-navigation label', true), ...(value.itemId ? { itemId: item(value.itemId).id } : {}) }
        : { ...(key === 'stages' ? { id: value.id } : {}), title: text(value.title, `${key} title`, true), body: text(value.body ?? '', `${key} body`), ...(value.afterMs == null ? {} : { afterMs: timing(value.afterMs, 'afterMs') }) });
    }
    return result;
  });
}
