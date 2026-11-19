// Element cards (spec #46 'Element Cards'): the slide editor's Elements panel. The slide's elements are
// cards that open to edit them: Title, Body, the Visual (candidate strip, star = pick, drawing parts
// table), Columns on a Columns slide, one card per step in play order, and More. A card shows only when
// the slide's type has its slot (spec #46 'Slide Types'); values the type has no slot for stay saved and
// hidden, and the panel says how many.
//
// Steps edit timing through presets over the saved fields (Starts = trigger, Wait before = afterMs,
// Speed = durationMs); a saved value matching no preset shows as Custom. With the slide's effective
// timing.betweenMs set (decision #119), Starts and Wait before on steps after the first are set by the
// gap and cannot be changed. Every change saves through the normal revision check; the server validates
// picks, parts and timing again (src/deck-data.js).
import { icons } from './icons.js';
import { SLIDE_TYPES, visualKind } from './slide-types.js';
import { missingParts, missingPartText, removeCandidate, slideOffers, startGallery, unstar, useOnSlide } from './deck-library.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const move = (values, from, to) => { if (from !== to && to >= 0 && to < values.length) values.splice(to, 0, ...values.splice(from, 1)); };
const iconButton = (action, label, icon, tone = '') => `<button type="button" class="icon-button ${tone}" data-slide-action="${action}" aria-label="${esc(label)}" title="${esc(label)}">${icons[icon]}</button>`;

// Presets (spec #46 'Element Cards'; FnB, 2026-11-19: the starting values, to be tuned after use).
export const SPEED = [['Fast', 400], ['Medium', 800], ['Slow', 1600]];
export const WAIT = [['None', 0], ['Short', 300], ['Medium', 1000], ['Long', 2500]];
export const STARTS = [['On click', 'manual'], ['After previous', 'auto']];
export const GAP_NOTE = 'Set by the gap between stages';
const seconds = ms => `${Number((ms / 1000).toFixed(2))} s`;
// How a step starts when its trigger is unset: automatically once it has a delay (the runtime's rule).
export const startsOf = stage => stage.trigger ?? ((stage.afterMs ?? 0) > 0 ? 'auto' : 'manual');
const effective = (design, slide, primitive, arg) => slide.design?.[primitive]?.[arg] ?? design?.[primitive]?.[arg] ?? null;
export const gapLocked = (design, slide, index) => index > 0 && effective(design, slide, 'timing', 'betweenMs') != null;

// ---- Slots: which cards a slide's type shows, and the saved values it hides.

/** The saved values the slide's type does not show, by plain name. */
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
/** The element cards a slide's type has, in panel order (steps are one card each, under 'steps'). */
export function slideCards(layout) {
  const type = SLIDE_TYPES[layout] || SLIDE_TYPES.statement;
  return ['title', 'body', ...(type.visual.length ? ['visual'] : []), ...(type.columns ? ['columns'] : []), 'steps', 'more'];
}
/** Which cards a canvas selection highlights and opens. */
export function cardsFor(block, slide) {
  if (block === 'copy') return ['title', 'body'];
  if (block === 'visual') return ['visual'];
  if (block === 'stageText') return (slide.stages || []).map(stage => `step:${stage.id}`);
  return [];
}

const picks = slide => [slide.media?.itemId, slide.vector?.itemId, ...(slide.subnav ?? []).map(view => view.itemId)].filter(Boolean);
const version = item => `v${item?.iteration ?? 1}`;
const nameOf = item => item ? `${item.label} ${version(item)}` : 'Missing media';
const drawingOf = (slide, items) => slide.vector ? items.find(item => item.id === slide.vector.itemId) || null : null;
const partsOf = drawing => drawing?.asset?.metadata?.svgGroupIds || [];

// ---- Markup

const SIDE_WORDS = { left: 'Left of the visual', right: 'Right of the visual', top: 'Above the visual', bottom: 'Below the visual' };
const ALIGN_WORDS = { start: ['top', 'left'], center: ['middle', 'centre'], end: ['bottom', 'right'] };
function placement(design, slide, visual) {
  const position = visual ? effective(design, slide, 'copy', 'position') : null;
  const align = effective(design, slide, 'copy', 'align'), valign = effective(design, slide, 'copy', 'valign');
  const where = align || valign ? (align === 'center' && valign === 'center' ? 'centred' : `${ALIGN_WORDS[valign || 'center'][0]} ${ALIGN_WORDS[align || 'start'][1]}`) : '';
  return [position ? SIDE_WORDS[position] : '', where].filter(Boolean).join(', ') || 'Template placement';
}
function motionLine(stage, drawing) {
  const kind = stage.motion === 'draw' ? 'Draws its strokes' : stage.motion === 'enter' ? 'Enters from its start state' : drawing ? 'Fades its parts in' : 'Fades in';
  const easing = { linear: 'at an even pace', 'ease-in': 'easing in', 'ease-out': 'easing out', 'ease-in-out': 'easing in and out' }[stage.easing];
  const hold = stage.holdMs ? `then holds ${seconds(stage.holdMs)}` : '';
  const moves = stage.changes?.length ? `moves ${count(stage.changes.length, 'part')}` : '';
  return [kind, easing, moves, hold].filter(Boolean).join(', ');
}
// One preset row: a segmented choice whose buttons write exact values; a saved value no preset has is a
// pressed Custom entry beside them.
function presetRow(key, caption, presets, value, { locked = false, unsetLabel = null } = {}) {
  const custom = value != null && !presets.some(([, preset]) => preset === value);
  const buttons = presets.map(([label, preset]) => `<button type="button" data-step-set="${key}" data-value="${preset}" aria-pressed="${!locked && preset === value}"${locked ? ' disabled' : ''}>${label}</button>`).join('')
    + (custom && !locked ? `<button type="button" aria-pressed="true" disabled data-custom="${key}">Custom ${esc(typeof value === 'number' ? seconds(value) : value)}</button>` : '');
  const note = locked ? `<span class="element-note" data-locked="${key}">${GAP_NOTE}</span>` : !custom && value == null && unsetLabel ? `<span class="element-note">${unsetLabel}</span>` : '';
  return `<div class="element-row" data-step-row="${key}"><span class="element-label">${caption}</span><div class="sb-segmented" role="group" aria-label="${caption}">${buttons}</div>${note}</div>`;
}
const field = (key, label, value, type = 'text') => `<label class="element-field">${esc(label)}${type === 'textarea'
  ? `<textarea data-slide-field="${key}">${esc(value)}</textarea>`
  : `<input data-slide-field="${key}" type="${type}" ${type === 'number' ? 'min="0" step="any"' : ''} value="${esc(value ?? '')}">`}</label>`;
const options = (values, selected) => values.map(([id, label]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');

function card(key, title, summary, body, { open, active, extra = '' }) {
  return `<details class="element-card${active.has(key) ? ' is-active' : ''}" data-card="${esc(key)}"${open.has(key) ? ' open' : ''}${extra}>
    <summary><span class="element-card-title">${title}</span><span class="element-card-summary">${esc(summary)}</span></summary>
    <div class="element-card-body">${body}</div></details>`;
}
const noticeHTML = (notice, key) => notice?.card === key ? `<p class="element-notice" role="alert" data-card-notice>${esc(notice.text)}</p>` : '';

function candidateTile(slide, id, items, starred) {
  const item = items.find(value => value.id === id), name = nameOf(item);
  const file = item && `/api/episodes/${encodeURIComponent(item.episodeId)}/library/${encodeURIComponent(item.id)}/file`;
  const kind = item && visualKind(item);
  const thumb = !item ? '<span class="candidate-missing">?</span>' : kind === 'video' ? `<video src="${file}" preload="metadata" muted></video>` : `<img src="${file}" alt="">`;
  return `<div class="candidate-tile${starred ? ' is-starred' : ''}" role="listitem" data-candidate="${esc(id)}">
    <span class="candidate-thumb">${thumb}</span><span class="candidate-name" title="${esc(name)}">${esc(name)}</span>
    <span class="candidate-actions"><button type="button" class="candidate-star" data-candidate-star="${esc(id)}" aria-pressed="${starred}" aria-label="Star ${esc(name)}" title="${starred ? 'Starred: on the slide. Click to unstar' : 'Star: use on the slide'}">${starred ? '★' : '☆'}</button>
    <button type="button" class="icon-button" data-candidate-remove="${esc(id)}" aria-label="Remove ${esc(name)} from candidates" title="Remove from candidates">${icons.trash}</button></span></div>`;
}
function visualCard(slide, items, ctx) {
  const type = SLIDE_TYPES[slide.layout], kinds = type.visual, drawing = drawingOf(slide, items);
  const picked = picks(slide), candidates = (slide.candidates || []).map(value => value.itemId);
  const gallery = kinds.includes('gallery') && (slide.subnav?.length > 0 || ctx.gallery);
  const pick = picked.length ? picked.map(id => nameOf(items.find(item => item.id === id))).join(', ') : 'No pick';
  const missing = missingParts(drawing, slide.stages);
  const offered = items.filter(item => slideOffers(slide, item) && !picked.includes(item.id) && !candidates.includes(item.id));
  const mode = kinds.includes('gallery') && kinds.some(kind => kind === 'image' || kind === 'video')
    ? `<div class="element-row"><span class="element-label">Shows</span><div class="sb-segmented" role="group" aria-label="Visual shows">${[['single', 'One visual'], ['gallery', 'Gallery']].map(([value, label]) =>
      `<button type="button" data-visual-mode="${value}" aria-pressed="${(value === 'gallery') === gallery}">${label}</button>`).join('')}</div></div>` : '';
  const strip = picked.length || candidates.length
    ? `<div class="candidate-strip" role="list" aria-label="Candidates">${[...picked.map(id => candidateTile(slide, id, items, true)), ...candidates.map(id => candidateTile(slide, id, items, false))].join('')}</div>`
    : '<p class="element-note">No candidates yet. Add one from the library.</p>';
  const add = `<label class="element-field">Add a candidate<select data-candidate-add><option value="">Choose from the library…</option>${options(offered.map(item => [item.id, nameOf(item)]), '')}</select></label>`;
  const alt = slide.vector ? field('vectorAlt', 'Drawing description', slide.vector.alt) : slide.media ? field('mediaAlt', 'Media description', slide.media.alt) : '';
  const views = slide.subnav?.length ? `<div class="element-views"><span class="element-label">Gallery, in play order</span>${slide.subnav.map((view, i) => `<div class="element-view" data-part="subnav" data-part-index="${i}">
      ${field('label', `View ${i + 1} label`, view.label)}<span class="element-view-item">${esc(nameOf(items.find(item => item.id === view.itemId)))}</span>
      <div class="icon-actions">${iconButton('part-up', 'Move view earlier', 'up')}${iconButton('part-down', 'Move view later', 'down')}</div></div>`).join('')}</div>` : '';
  const parts = drawing ? partsTable(slide, drawing) : '';
  const open = picked.length === 1 && items.some(item => item.id === picked[0]) ? `<button type="button" data-open-asset="${esc(picked[0])}">${icons.edit} Open asset</button>` : '';
  const warn = missing.map(part => `<p class="element-warning" role="alert" data-missing-part>${esc(missingPartText(drawing, part))}</p>`).join('');
  return card('visual', 'Visual', pick, `${noticeHTML(ctx.notice, 'visual')}${warn}${mode}${strip}${add}${alt}${views}${parts}${open}`,
    { ...ctx, extra: ` data-visual-kinds="${kinds.join(' ')}"` });
}
// Drawing parts: one row per part of the picked drawing, with one Appears choice (From the start, or one
// step). A part can be in one step only.
function partsTable(slide, drawing) {
  const stages = slide.stages || [], owner = id => stages.findIndex(stage => (stage.svgGroupIds || []).includes(id));
  const rows = partsOf(drawing).map(id => `<tr><th scope="row">${esc(id)}</th><td><select data-part-appears="${esc(id)}" aria-label="${esc(id)} appears">${options([['', 'From the start'],
    ...stages.map((stage, i) => [String(i), `Step ${i + 1}: ${stage.title}`])], owner(id) < 0 ? '' : String(owner(id)))}</select></td></tr>`).join('');
  return `<table class="element-parts" data-parts-table><caption>Drawing parts</caption><thead><tr><th scope="col">Part</th><th scope="col">Appears</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function stepCard(slide, stage, i, items, ctx) {
  const design = ctx.design, locked = gapLocked(design, slide, i), drawing = drawingOf(slide, items);
  const starts = locked ? 'auto' : startsOf(stage), speed = stage.durationMs == null ? 'Standard' : SPEED.find(([, ms]) => ms === stage.durationMs)?.[0] || `Custom ${seconds(stage.durationMs)}`;
  const reveals = (stage.svgGroupIds || []);
  const style = effective(design, slide, 'stageText', 'style') ?? (slide.vector ? 'chips' : 'steps');
  const summary = [STARTS.find(([, value]) => value === starts)[0], speed, drawing ? (reveals.length ? `reveals ${reveals.join(', ')}` : 'reveals nothing') : ''].filter(Boolean).join(' · ');
  const claimed = new Set((slide.stages || []).flatMap(value => value.svgGroupIds || []));
  const revealRow = drawing ? `<div class="element-row" data-reveals><span class="element-label">Reveals</span><div class="element-chips">${reveals.map(id => `<span class="element-chip">${esc(id)}<button type="button" data-reveal-remove="${esc(id)}" aria-label="Remove ${esc(id)} from step ${i + 1}" title="Remove">×</button></span>`).join('') || '<span class="element-note">Nothing</span>'}</div>
      <select data-reveal-add aria-label="Add part to step ${i + 1}"><option value="">Add part…</option>${options(partsOf(drawing).filter(id => !claimed.has(id)).map(id => [id, id]), '')}</select></div>` : '';
  const title = `<span class="element-grip" data-step-grip draggable="true" title="Drag to reorder" aria-hidden="true">${icons.grip}</span>Step ${i + 1}: ${esc(stage.title)}`;
  const body = `${noticeHTML(ctx.notice, `step:${stage.id}`)}${field('title', 'Button label', stage.title)}
    ${field('body', style === 'chips' ? 'Step text (not shown in chips style)' : 'Step text', stage.body, 'textarea')}
    ${presetRow('trigger', 'Starts', STARTS, starts, { locked })}
    ${presetRow('afterMs', 'Wait before', WAIT, stage.afterMs ?? (locked ? null : 0), { locked })}
    ${presetRow('durationMs', 'Speed', SPEED, stage.durationMs ?? null, { unsetLabel: 'Standard' })}
    ${revealRow}<p class="element-motion" data-motion-line>${esc(motionLine(stage, drawing))}</p>
    <div class="element-card-actions"><button type="button" data-play-step="${i}">${icons.play} Play step</button>
    <div class="icon-actions">${iconButton('part-up', `Move step ${i + 1} earlier`, 'up')}${iconButton('part-down', `Move step ${i + 1} later`, 'down')}${iconButton('part-delete', `Remove step ${i + 1}`, 'trash', 'danger')}</div></div>`;
  return `<div data-part="stages" data-part-index="${i}">${card(`step:${stage.id}`, title, summary, body, ctx)}</div>`;
}
function columnsCard(slide, ctx) {
  const columns = slide.columns || [];
  const body = columns.map((column, i) => `<div class="element-column" data-part="columns" data-part-index="${i}">${field('title', `Column ${i + 1} title`, column.title)}${field('body', `Column ${i + 1} text`, column.body, 'textarea')}
    <div class="icon-actions">${iconButton('part-up', 'Move column left', 'up')}${iconButton('part-down', 'Move column right', 'down')}${iconButton('part-delete', 'Remove column', 'trash', 'danger')}</div></div>`).join('')
    + `<button type="button" data-slide-action="add-columns">Add column</button>`;
  return card('columns', 'Columns', count(columns.length, 'column'), body, ctx);
}
function addElement(slide, items) {
  const type = SLIDE_TYPES[slide.layout];
  const visuals = type?.visual.length && !picks(slide).length ? items.filter(item => slideOffers(slide, item)) : [];
  return `<label class="element-add">Add element<select data-add-element><option value="">Choose…</option><option value="step">Step</option>${visuals.length
    ? `<optgroup label="Visual from the library">${options(visuals.map(item => [`visual:${item.id}`, nameOf(item)]), '')}</optgroup>` : ''}</select></label>`;
}

/** The Elements panel for one slide. `ctx`: items (library, or null while loading), sections, design (the
 *  deck's), open and active (Sets of card keys), notice ({card, text}) and gallery (the Gallery mode was
 *  chosen before any view was starred). */
export function elementCardsHTML(slide, index, ctx) {
  const items = ctx.items || [], settings = { open: ctx.open || new Set(), active: ctx.active || new Set(), design: ctx.design || {}, notice: ctx.notice, gallery: ctx.gallery };
  const hidden = hiddenValues(slide), cards = slideCards(slide.layout), visual = Boolean(slide.vector || slide.subnav?.length || slide.media);
  const html = {
    title: () => card('title', 'Title', slide.title, field('title', 'Title', slide.title) + field('eyebrow', 'Header label', slide.eyebrow), settings),
    body: () => card('body', 'Body', placement(settings.design, slide, visual), field('body', 'Body', slide.body, 'textarea') + field('caption', 'Caption', slide.caption)
      + `<p class="element-note" data-placement>Placement: ${esc(placement(settings.design, slide, visual))}. Select the text on the slide to move it.</p>`, settings),
    visual: () => visualCard(slide, items, settings),
    columns: () => columnsCard(slide, settings),
    steps: () => `<section class="element-steps" data-card-group="steps" aria-label="Steps"><h4>Steps <small>in play order</small></h4>${(slide.stages || []).map((stage, i) => stepCard(slide, stage, i, items, settings)).join('')
      || '<p class="element-note">No steps: everything shows when the slide opens.</p>'}</section>`,
    more: () => card('more', 'More', `${slide.targetMinutes ?? 0} min`, field('notes', 'Speaker notes', slide.notes, 'textarea') + field('targetMinutes', 'Target duration (minutes)', slide.targetMinutes, 'number')
      + `<label class="element-field">Story section<select data-slide-field="sectionId">${options([['', 'Unassigned'], ...(ctx.sections || []).map(s => [s.id, s.title])], slide.sectionId || '')}</select></label>`, settings),
  };
  return `<div class="deck-slide element-cards" data-slide-index="${index}">
    ${hidden.length ? `<p class="deck-hidden-values" data-hidden-count="${hidden.length}">${count(hidden.length, 'saved value')} hidden by this layout (${hidden.join(', ')}). They are kept; choose a layout that shows them to edit them.</p>` : ''}
    ${cards.map(key => html[key]()).join('')}${addElement(slide, items)}
  </div>`;
}

// ---- Behaviour

const stageFields = ['trigger', 'afterMs', 'durationMs', 'holdMs', 'easing', 'motion'];
/** Edits inside `root` change the slide under the nearest [data-slide-index]. Typing marks the production
 *  dirty; a committed change saves. Structural changes re-render at once. `notify(card, text)` shows a
 *  refusal on that card without saving; `onReplay(index)` replays a step once its change is saved;
 *  `onPlayStep(index)` plays it now; `onOpenAsset(itemId)` opens the asset preview. */
export function bindElementCards(root, { getSlides, getItems = () => [], onDirty, onSave, render, notify = () => {}, onReplay = () => {}, onPlayStep = () => {},
  onOpenAsset = () => {}, onToggle = () => {}, isGallery = () => false, onGalleryMode = () => {} }) {
  const at = target => {
    const index = Number(target.closest('[data-slide-index]')?.dataset.slideIndex);
    return { index, slide: getSlides()[index] };
  };
  const stageAt = target => {
    const row = target.closest('[data-part="stages"]');
    return row ? Number(row.dataset.partIndex) : -1;
  };
  const commit = () => { onDirty(); render(); onSave(); };
  // Replaces the slide (the candidate helpers return a new one) and saves.
  const replace = (index, next) => { getSlides()[index] = next; commit(); };
  const item = id => (getItems() || []).find(value => value.id === id);

  root.addEventListener('input', event => {
    const field = event.target.dataset.slideField;
    if (!field) return;
    const { slide } = at(event.target);
    if (!slide) return;
    const part = event.target.closest('[data-part]');
    const target = part ? slide[part.dataset.part][Number(part.dataset.partIndex)] : slide;
    const value = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
    if (stageFields.includes(field) && event.target.value === '') delete target[field];
    else if (field === 'layout') { target.layout = value; commit(); return; }
    else if (field === 'vectorAlt') { if (target.vector) target.vector.alt = value; }
    else if (field === 'mediaAlt') { if (target.media) target.media.alt = value; }
    else target[field] = value;
    onDirty();
  });
  root.addEventListener('change', event => {
    const data = event.target.dataset;
    if (data.slideField) { if (data.slideField !== 'layout') onSave(); return; }
    const { slide, index } = at(event.target);
    if (!slide) return;
    const value = event.target.value;
    if ('candidateAdd' in data) {
      if (!value) return;
      return replace(index, { ...slide, candidates: [...(slide.candidates || []), { itemId: value, alt: '' }] });
    }
    if ('addElement' in data) {
      event.target.value = '';
      if (value === 'step') { (slide.stages ||= []).push({ id: `stage_${crypto.randomUUID()}`, title: 'New step', body: '' }); return commit(); }
      if (value.startsWith('visual:')) return star(index, slide, value.slice(7));
      return;
    }
    if ('partAppears' in data) return appears(index, slide, data.partAppears, value === '' ? -1 : Number(value), 'visual');
    if ('revealAdd' in data && value) appears(index, slide, value, stageAt(event.target), `step:${slide.stages[stageAt(event.target)].id}`);
  });
  root.addEventListener('toggle', event => {
    const key = event.target.dataset?.card;
    if (key) onToggle(key, event.target.open);
  }, true);

  // Star = pick. A drawing whose parts lack one a step reveals is refused here with the spec's line (the
  // server refuses it too); everything else goes to the server and its rules.
  function star(index, slide, id) {
    const value = item(id);
    if (!value) return;
    if (picks(slide).includes(id)) return replace(index, unstar(slide, id));
    const kind = visualKind(value);
    if (kind === 'drawing') {
      const missing = missingParts(value, slide.stages);
      if (missing.length) return notify('visual', missing.map(part => missingPartText(value, part)).join(' '));
    }
    const gallery = kind !== 'drawing' && !slide.subnav?.length && SLIDE_TYPES[slide.layout]?.visual.includes('gallery') && isGallery(slide.id);
    replace(index, gallery ? startGallery(slide, value) : useOnSlide(slide, value));
  }
  // One part, one place: a step, or from the start (-1). A step left revealing nothing is refused, as
  // the server refuses it.
  function appears(index, slide, part, to, card) {
    const stages = slide.stages || [], from = stages.findIndex(stage => (stage.svgGroupIds || []).includes(part));
    if (from === to) return;
    if (from >= 0) {
      const left = stages[from].svgGroupIds.filter(id => id !== part);
      if (!left.length && !stages[from].changes?.length) {
        return notify(card, `Step ${from + 1} would reveal nothing; give it another part first.`);
      }
      stages[from].svgGroupIds = left;
    }
    if (to >= 0) stages[to].svgGroupIds = [...(stages[to].svgGroupIds || []), part];
    commit();
  }
  function preset(slide, i, key, raw) {
    const stage = slide.stages[i], value = key === 'trigger' ? raw : Number(raw);
    if (stage[key] === value) return;
    // Waiting before a step never changes how it starts: an unset trigger is pinned first.
    if (key === 'afterMs' && stage.trigger === undefined) stage.trigger = startsOf(stage);
    stage[key] = value;
    commit(); onReplay(i);
  }

  root.addEventListener('click', event => {
    const target = event.target, { slide, index } = at(target);
    if (!slide) return;
    const set = target.closest('[data-step-set]');
    if (set) return preset(slide, stageAt(set), set.dataset.stepSet, set.dataset.value);
    const play = target.closest('[data-play-step]');
    if (play) return onPlayStep(Number(play.dataset.playStep));
    const starButton = target.closest('[data-candidate-star]');
    if (starButton) return star(index, slide, starButton.dataset.candidateStar);
    const remove = target.closest('[data-candidate-remove]');
    if (remove) {
      try { return replace(index, removeCandidate(slide, remove.dataset.candidateRemove)); } catch (error) { return notify('visual', error.message); }
    }
    const reveal = target.closest('[data-reveal-remove]');
    if (reveal) return appears(index, slide, reveal.dataset.revealRemove, -1, `step:${slide.stages[stageAt(reveal)].id}`);
    const mode = target.closest('[data-visual-mode]');
    if (mode) return visualMode(index, slide, mode.dataset.visualMode);
    const asset = target.closest('[data-open-asset]');
    if (asset) return onOpenAsset(asset.dataset.openAsset);
    const action = target.closest('[data-slide-action]')?.dataset.slideAction;
    if (!action || !(action.startsWith('add-') || action.startsWith('part-'))) return;
    if (action.startsWith('add-')) {
      const key = action.slice(4);
      (slide[key] ||= []).push(key === 'stages' ? { id: `stage_${crypto.randomUUID()}`, title: 'New step', body: '' } : { title: 'New column', body: '' });
    } else {
      const row = target.closest('[data-part]'), values = slide[row.dataset.part], from = Number(row.dataset.partIndex);
      if (action === 'part-delete') values.splice(from, 1); else move(values, from, from + (action === 'part-up' ? -1 : 1));
    }
    commit();
  });
  // One visual or a gallery. Gallery: the media pick becomes the first view. One visual: the first view
  // becomes the media pick and the other views return to the candidates.
  function visualMode(index, slide, mode) {
    if (mode === 'gallery') {
      if (slide.subnav?.length) return;
      const media = slide.media && item(slide.media.itemId);
      onGalleryMode(slide.id, true);
      if (!media) return render();
      return replace(index, startGallery(slide, media));
    }
    onGalleryMode(slide.id, false);
    if (!slide.subnav?.length) return render();
    let next = slide;
    for (const view of slide.subnav) next = view.itemId ? unstar(next, view.itemId) : { ...next, subnav: next.subnav.filter(value => value !== view) };
    const first = slide.subnav[0].itemId && item(slide.subnav[0].itemId);
    replace(index, first ? useOnSlide(next, first) : next);
  }

  // Steps reorder by grip drag; the step under the pointer shows where the dragged one lands.
  let dragged = null;
  const clear = () => root.querySelectorAll('[data-drop]').forEach(node => node.removeAttribute('data-drop'));
  const over = event => {
    const row = event.target.closest?.('[data-part="stages"]');
    if (!row || dragged === null) return null;
    const box = row.getBoundingClientRect(), after = event.clientY > box.top + box.height / 2;
    return { row, after, to: Number(row.dataset.partIndex) + (after ? 1 : 0) };
  };
  root.addEventListener('dragstart', event => {
    const row = event.target.closest?.('[data-step-grip]')?.closest('[data-part="stages"]');
    if (!row) return;
    dragged = Number(row.dataset.partIndex);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/storybench-step', String(dragged));
  });
  root.addEventListener('dragover', event => {
    const spot = over(event);
    if (!spot) return;
    event.preventDefault(); clear();
    spot.row.dataset.drop = spot.after ? 'after' : 'before';
  });
  root.addEventListener('drop', event => {
    const spot = over(event), from = dragged;
    if (!spot) return;
    event.preventDefault(); clear();
    const to = spot.to > from ? spot.to - 1 : spot.to;
    if (to === from) return;
    move(at(spot.row).slide.stages, from, to); commit();
  });
  root.addEventListener('dragend', () => { dragged = null; clear(); });
}
