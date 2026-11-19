// The Media Library's deck model (spec #46 'Media Library', 'Asset preview'): where each library item
// stands on the slides, its iteration group, and the slide changes the library makes (Use on slide, add
// or remove a candidate). Pure functions over the saved slides and library items, so the browser and the
// tests share them; the server re-validates every save (src/deck-data.js validateSlides).
import { SLIDE_TYPES, visualKind } from './slide-types.js';

export { visualKind };
export const slideNumber = index => String(index + 1).padStart(2, '0');
const picks = slide => [slide.media?.itemId, slide.vector?.itemId, ...(slide.subnav ?? []).map(view => view.itemId)].filter(Boolean);
const candidateIds = slide => (slide.candidates ?? []).map(value => value.itemId);

/** Where one item stands: each slide that picks it ('on', starred) or lists it as a candidate. */
export function usage(slides, itemId) {
  return slides.flatMap((slide, index) => picks(slide).includes(itemId) ? [{ slide, index, state: 'on' }]
    : candidateIds(slide).includes(itemId) ? [{ slide, index, state: 'candidate' }] : []);
}
/** 'on', 'candidate' or 'dimmed' (in the group, not a candidate of this slide). */
export const tileState = (slide, itemId) => picks(slide).includes(itemId) ? 'on' : candidateIds(slide).includes(itemId) ? 'candidate' : 'dimmed';
/** "On 06, Candidate for 02" for a By type tile; empty when the item is on no slide. */
export const usageText = (slides, itemId) => usage(slides, itemId)
  .map(({ index, state }) => `${state === 'on' ? 'On' : 'Candidate for'} ${slideNumber(index)}`).join(', ');

/** Iteration groups in library order (by each group's first item), each sorted v1..vn. */
export function iterationGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.iterationGroup ?? item.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].map(group => group.sort((a, b) => (a.iteration ?? 1) - (b.iteration ?? 1)));
}
export const groupOf = (items, item) => iterationGroups(items).find(group => group.includes(item)) ?? [item];

/** The By type sections, in the spec's order. References are anything that is not visual media or audio. */
export const TYPE_SECTIONS = [['drawing', 'Drawings'], ['image', 'Images'], ['video', 'Video'], ['audio', 'Audio'], ['reference', 'References']];
export const typeOf = item => visualKind(item) ?? (item.asset?.kind === 'audio' ? 'audio' : 'reference');

/** The By slide grouping: one entry per slide with picks or candidates (its iteration groups), then the
 *  visual groups on no slide, then references and audio (never candidates). */
export function bySlide(slides, items) {
  const groups = iterationGroups(items.filter(item => visualKind(item)));
  const used = new Set(slides.flatMap(slide => [...picks(slide), ...candidateIds(slide)]));
  return {
    slides: slides.map((slide, index) => {
      const mine = new Set([...picks(slide), ...candidateIds(slide)]);
      return { slide, index, groups: groups.filter(group => group.some(item => mine.has(item.id))) };
    }).filter(entry => entry.groups.length),
    unused: groups.filter(group => !group.some(item => used.has(item.id))),
    context: items.filter(item => !visualKind(item)),
  };
}
/** The visual items on no slide (the Not on a slide filter). */
export const notOnSlide = (slides, items) => items.filter(item => visualKind(item) && !usage(slides, item.id).length);

/** Can this slide's type show this item? Drawings need a drawing slot; images and video an image, video
 *  or gallery slot. References and audio never. */
export function slideOffers(slide, item) {
  const kind = visualKind(item), visual = SLIDE_TYPES[slide.layout]?.visual ?? [];
  if (!kind) return false;
  return kind === 'drawing' ? visual.includes('drawing') : visual.includes(kind) || visual.includes('gallery');
}

/** Clean up: iterations in groups of two or more that are not starred, not a candidate and not an
 *  assistant reference on any slide (or the deck). References and audio are never offered. */
export function cleanupEligible(episode, items) {
  const slides = episode.cards ?? [];
  const held = new Set([...(episode.referenceItemIds ?? []), ...slides.flatMap(slide => [...picks(slide), ...candidateIds(slide), ...(slide.referenceItemIds ?? [])])]);
  return iterationGroups(items.filter(item => visualKind(item))).filter(group => group.length > 1).flat().filter(item => !held.has(item.id));
}

const candidateOf = (slide, itemId) => (slide.candidates ?? []).find(value => value.itemId === itemId);
const without = (slide, itemId) => (slide.candidates ?? []).filter(value => value.itemId !== itemId);
const uniqueId = (taken, base) => { let n = 1; while (taken.has(`${base}${n}`)) n += 1; return `${base}${n}`; };

/** Use on slide: star a candidate. A drawing takes the drawing slot; image or video takes the gallery
 *  when the slide has one, else the media slot. A plain visual has one star, so the asset it replaces
 *  (and, switching between drawing and media, the other slot's pick) moves back to the candidates.
 *  Leaving the drawing drops what only its parts carried, as deleting it does. Combinations today's
 *  rules refuse (a drawing beside a gallery, a type without the slot) reach the server and its message. */
export function useOnSlide(slide, item) {
  const kind = visualKind(item), itemId = item.id;
  if (!kind || picks(slide).includes(itemId)) return slide;
  const entry = candidateOf(slide, itemId) ?? { itemId, alt: '' };
  const next = { ...slide, candidates: without(slide, itemId) };
  const unstar = value => { if (value?.itemId) next.candidates.push({ itemId: value.itemId, alt: value.alt ?? '' }); };
  if (kind !== 'drawing' && (slide.subnav ?? []).length) {
    const label = entry.label || item.label;
    next.subnav = [...slide.subnav, { id: uniqueId(new Set(slide.subnav.map(view => view.id)), 'view'), label, itemId }];
    return next;
  }
  if (kind === 'drawing') {
    unstar(slide.vector); unstar(slide.media);
    return { ...next, media: null, vector: { itemId, alt: entry.alt ?? '' } };
  }
  unstar(slide.media); unstar(slide.vector);
  if (slide.vector) next.stages = (slide.stages ?? []).map(({ svgGroupIds: _groups, changes: _changes, from: _from, motion, ...stage }) =>
    ({ ...stage, ...(motion === undefined || motion === 'draw' || motion === 'enter' ? {} : { motion }) }));
  return { ...next, vector: null, media: { itemId, alt: entry.alt ?? '' } };
}
/** Candidate for a slide: add an unpicked candidate (no star). */
export const addCandidate = (slide, item) => picks(slide).includes(item.id) || candidateOf(slide, item.id) ? slide
  : { ...slide, candidates: [...(slide.candidates ?? []), { itemId: item.id, alt: '' }] };
/** Remove an unpicked candidate. A starred asset is refused: star another first. */
export function removeCandidate(slide, itemId) {
  if (picks(slide).includes(itemId)) throw new Error('This asset is starred on the slide; star another first, then remove it.');
  return { ...slide, candidates: without(slide, itemId) };
}
/** Unstar: the asset leaves the pick and returns to the candidates. A gallery view keeps its label on its
 *  candidate. Leaving the drawing drops what only its parts carried, as useOnSlide does. */
export function unstar(slide, itemId) {
  if (!picks(slide).includes(itemId)) return slide;
  const next = { ...slide, candidates: [...without(slide, itemId)] };
  const view = (slide.subnav ?? []).find(value => value.itemId === itemId);
  if (view) {
    next.subnav = slide.subnav.filter(value => value !== view);
    next.candidates.push({ itemId, alt: '', ...(view.label ? { label: view.label } : {}) });
    return next;
  }
  const own = slide.vector?.itemId === itemId ? slide.vector : slide.media;
  next.candidates.push({ itemId, alt: own.alt ?? '' });
  if (slide.media?.itemId === itemId) return { ...next, media: null };
  next.stages = withoutParts(slide.stages);
  return { ...next, vector: null };
}
const withoutParts = stages => (stages ?? []).map(({ svgGroupIds: _groups, changes: _changes, from: _from, motion, ...stage }) =>
  ({ ...stage, ...(motion === undefined || motion === 'draw' || motion === 'enter' ? {} : { motion }) }));
/** Starts a gallery with this image or video as its first view (the slide's media pick, if any, moves
 *  back to the candidates). */
export function startGallery(slide, item) {
  const next = useOnSlide({ ...slide, subnav: [] }, item);
  if (next.media?.itemId !== item.id) return next;
  const entry = candidateOf(slide, item.id);
  return { ...next, media: null, subnav: [{ id: 'view1', label: entry?.label || item.label, itemId: item.id }] };
}

/** The parts a step reveals that a drawing lacks; `stages` default to the slide's own. */
export function missingParts(drawing, stages) {
  const parts = drawing?.asset?.metadata?.svgGroupIds;
  if (!parts) return [];
  return [...new Set((stages ?? []).flatMap(stage => stage.svgGroupIds ?? []))].filter(id => !parts.includes(id));
}
/** The warning beside a picked drawing that lacks a stepped part (spec #46 'Candidates'). */
export const missingPartText = (drawing, partId) => `v${drawing.iteration ?? 1} has no part ${partId}, so a step reveals nothing.`;
// Ask for another from a slide's Visual card (spec #46 Iterations): the composer note names the slide, the
// picked asset and its iteration, so the deck guidance's slide route applies (an unstarred candidate of that
// slide). The asset preview's Ask names no slide and keeps the result in the group (library-workspace.js).
export const askFromSlideText = (slide, index, item) => `On slide ${slideNumber(index)} “${slide.title}” (${slide.id}): make another iteration of its picked visual “${item.label}” (library item ${item.id}, v${item.iteration ?? 1}). Register it with iterationOf ${item.id} and add it to this slide's candidates, unstarred unless I say to use it. What to change: `;
