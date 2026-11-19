// Slide types (spec #46 'Slide Types'): which slots each type has, declared once. The slide editor,
// validateSlides (src/deck-data.js) and the save_deck tool description read it; the deck build keeps
// its own checks. Kept free of imports so the browser and the server load this same file.
//
// visual: what the type's visual slot offers: 'drawing' (a registered SVG, saved in `vector`), 'image'
//   and 'video' (saved in `media`), 'gallery' (views saved in `subnav`). An empty list: no visual slot.
// columns: [min, max] columns, or null for no columns slot. steps: 'optional' or 'required'.
// Saved values stay as today's `layout` keys; `label` is the plain display name.
//
// The table states the combinations the editor offers. Saving keeps today's wider acceptance (a gallery
// on any type, media saved on any type but rendered only where the type shows images), so a value the
// type has no slot for is kept, hidden, when the type changes.
const type = (label, visual, { columns = null, steps = 'optional' } = {}) =>
  Object.freeze({ label, copy: true, visual: Object.freeze(visual), columns: columns && Object.freeze(columns), steps });
const MEDIA = ['image', 'video', 'drawing', 'gallery'];
export const SLIDE_TYPES = Object.freeze({
  title: type('Title', ['drawing']),
  section: type('Section break', []),
  statement: type('Statement', []),
  'text-media': type('Text and media', MEDIA),
  columns: type('Columns', [], { columns: [2, 3] }),
  'full-media': type('Full media', MEDIA),
  process: type('Process', ['drawing'], { steps: 'required' }),
});
export const SLIDE_TYPE_NAMES = Object.freeze(Object.keys(SLIDE_TYPES));
export const typeHasVisual = (layout, kind) => Boolean(SLIDE_TYPES[layout]?.visual.includes(kind));

// What a library item can be on a slide's visual: 'drawing' (an SVG image), 'image' (a raster image),
// 'video', or null (audio, references and anything else are never candidates).
export function visualKind(item) {
  const asset = item?.asset;
  if (asset?.kind === 'video') return 'video';
  if (asset?.kind !== 'image') return null;
  return asset.metadata?.contentType === 'image/svg+xml' ? 'drawing' : 'image';
}
