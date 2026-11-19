// Saved composition data, shared by manual editing and runtime tools. No executable markup.
import { fontForFamily } from './fonts.js';
import { SLIDE_TYPES, SLIDE_TYPE_NAMES, typeHasVisual, visualKind } from '../public/slide-types.js';
import { validateDrawingParts } from '../public/drawing-parts.js';
export { SLIDE_TYPES, visualKind };
export const DECK_LAYOUTS = SLIDE_TYPE_NAMES;
export const STAGE_TRIGGERS = ['auto', 'manual'];
export const STAGE_EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];
export const STAGE_MOTIONS = ['fade', 'draw', 'enter'];
const STAGE_LIMITS = { afterMs: 3600000, durationMs: 60000, holdMs: 3600000 };
// A group's state relative to its authored geometry: x/y in SVG user units, rotate in degrees.
const STATE_LIMITS = { x: [-8192, 8192], y: [-8192, 8192], scale: [0, 16], rotate: [-3600, 3600], opacity: [0, 1] };
const MAX_STAGE_CHANGES = 64;
function bounded(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be a number from ${min} to ${max}`);
  return value;
}
function groupState(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object of x, y, scale, rotate, opacity`);
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(STATE_LIMITS, key)) throw new Error(`${name}.${key} is not supported; use x, y, scale, rotate, opacity`);
    result[key] = bounded(entry, `${name}.${key}`, ...STATE_LIMITS[key]);
  }
  return result;
}
// The optional timing and motion fields of one stage, validated; unset (or null) fields are omitted.
// Shared by save and build. Errors name the field; callers add the slide and stage.
export function stageMotion(stage) {
  const result = {};
  for (const [key, max] of Object.entries(STAGE_LIMITS)) if (stage[key] != null) result[key] = bounded(stage[key], key, 0, max);
  for (const [key, allowed] of [['trigger', STAGE_TRIGGERS], ['easing', STAGE_EASINGS], ['motion', STAGE_MOTIONS]]) {
    if (stage[key] == null) continue;
    if (!allowed.includes(stage[key])) throw new Error(`${key} must be one of ${allowed.join(', ')}`);
    result[key] = stage[key];
  }
  if (stage.from != null) result.from = groupState(stage.from, 'from');
  if (stage.changes != null) {
    if (!Array.isArray(stage.changes)) throw new Error('changes must be an array of {groupId, to}');
    if (stage.changes.length > MAX_STAGE_CHANGES) throw new Error(`changes holds at most ${MAX_STAGE_CHANGES} entries`);
    result.changes = stage.changes.map((change, i) => {
      if (!change || typeof change.groupId !== 'string' || !change.groupId) throw new Error(`changes[${i}] needs a groupId`);
      return { groupId: change.groupId, to: groupState(change.to, `changes[${i}].to`) };
    });
  }
  return result;
}
// A stage that reveals no SVG group has only text to show, and text can only fade.
export function validateTextStage(stage) {
  if (['draw', 'enter'].includes(stage.motion)) throw new Error(`${stage.motion} moves SVG groups; a text-only stage can only fade`);
  if (stage.changes?.length) throw new Error('changes move SVG groups and require a vector composition');
}
// Used with registered metadata on save and freshly parsed source on export. `strokedIds`
// lists the groups holding stroked geometry; null (metadata predating it) defers draw to export.
export function validateVectorStages(stages, groupIds, strokedIds = null) {
  if (!Array.isArray(stages) || !stages.length) throw new Error('Vector composition requires reveal stages');
  const owner = new Map(), stageIds = new Set();
  for (const [index, stage] of stages.entries()) {
    if (!stage || typeof stage.id !== 'string' || !stage.id.trim() || stageIds.has(stage.id)) throw new Error('Vector stage IDs must be nonempty and unique');
    stageIds.add(stage.id);
    const groups = stage.svgGroupIds ?? [];
    if (!Array.isArray(groups) || (!groups.length && !stage.changes?.length)) throw new Error(`Stage ${stage.id}: select at least one SVG group`);
    for (const id of groups) {
      if (typeof id !== 'string' || !groupIds.includes(id)) throw new Error(`Stage ${stage.id}: missing SVG group ${id}`);
      if (owner.has(id)) throw new Error(`Stage ${stage.id}: duplicate SVG group mapping ${id}`);
      owner.set(id, index);
    }
  }
  for (const [index, stage] of stages.entries()) {
    const fail = message => { throw new Error(`Stage ${stage.id}: ${message}`); };
    const groups = stage.svgGroupIds ?? [], changed = new Set();
    if (!groups.length && ['draw', 'enter'].includes(stage.motion)) fail(`${stage.motion} moves SVG groups; a text-only stage can only fade`);
    if (stage.motion === 'draw' && strokedIds) for (const id of groups) if (!strokedIds.includes(id)) fail(`draw needs stroked geometry and SVG group ${id} has none`);
    for (const { groupId } of stage.changes ?? []) {
      if (!groupIds.includes(groupId)) fail(`changes names unknown SVG group ${groupId}`);
      if (!owner.has(groupId)) fail(`changes names SVG group ${groupId}, which no stage reveals`);
      if (owner.get(groupId) > index) fail(`changes names SVG group ${groupId}, first revealed by later stage ${stages[owner.get(groupId)].id}`);
      if (owner.get(groupId) === index) fail(`changes names SVG group ${groupId}, which this stage reveals; change it from a later stage`);
      if (changed.has(groupId)) fail(`changes names SVG group ${groupId} twice`);
      changed.add(groupId);
    }
  }
}
// The library items a slide shows today (its picks): media, vector and gallery views, in that order.
export const slidePicks = slide => [slide.media?.itemId, slide.vector?.itemId, ...(slide.subnav ?? []).map(view => view.itemId)].filter(Boolean);
const PICK_SETTERS = ['creator', 'agent'];
/** Validates saved slides. Candidates (spec #46): the picked assets stay in media, vector and subnav;
 *  `candidates` lists the slide's unpicked ones, each {itemId, alt, label?}. With `previous` (the saved
 *  slides) and `setBy` (creator|agent), this is a save: a slide that omits `candidates` keeps its saved
 *  list (less any asset it now picks), a supplied list replaces it, and a supplied list may not drop a
 *  saved pick (unstar it into candidates first, remove it later). A save that changes a slide's picks
 *  records `pickSetBy`; an unchanged one keeps it. Without `setBy` (undo, build) the recorded
 *  `pickSetBy` is kept as saved. */
export function validateSlides(slides, { libraryItems = [], sections = [], design: deckDesign = {}, previous = null, setBy = null, checkRevealParts = true } = {}) {
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
  if (setBy !== null && !PICK_SETTERS.includes(setBy)) fail('setBy must be creator or agent');
  const saved = new Map((previous ?? []).map(value => [value.id, value]));
  return slides.map((slide) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(slide.id)) fail("Slide IDs must be safe identifiers");
    if (!DECK_LAYOUTS.includes(slide.layout)) fail(`Unknown layout on slide ${slide.id}`);
    const result = { id: slide.id, title: text(slide.title, 'Slide title', true), layout: slide.layout,
      body: text(slide.body ?? '', 'body'), notes: text(slide.notes ?? '', 'notes'),
      eyebrow: text(slide.eyebrow ?? '', 'eyebrow'), caption: text(slide.caption ?? '', 'caption'),
      targetMinutes: timing(slide.targetMinutes ?? 0, 'targetMinutes'), sectionId: slide.sectionId || null,
      referenceItemIds: [], stages: [], subnav: [], columns: [], media: null };
    if (result.sectionId && !sections.some(s => s.id === result.sectionId)) fail(`Story section not found: ${result.sectionId}`);
    // Stage refusals name the slide and the stage.
    const staged = (stage, check) => { try { return check(); } catch (error) { fail(`Slide ${slide.id}: Stage ${stage.id}: ${error.message}`); } };
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
        : key === 'columns'
          ? { title: text(value.title, `${key} title`, true), body: text(value.body ?? '', `${key} body`), ...(value.afterMs == null ? {} : { afterMs: timing(value.afterMs, 'afterMs') }) }
          : { id: value.id, ...(value.svgGroupIds === undefined ? {} : { svgGroupIds: value.svgGroupIds }), title: text(value.title, `${key} title`, true), body: text(value.body ?? '', `${key} body`), ...staged(value, () => stageMotion(value)) });
    }
    if (slide.vector) {
      const selected = item(slide.vector.itemId);
      if (selected.asset?.kind !== 'image' || selected.asset.metadata?.contentType !== 'image/svg+xml') fail(`Slide ${slide.id}: vector must reference a registered SVG image`);
      if (slide.media || result.subnav.length) fail(`Slide ${slide.id}: vector composition cannot also contain media or gallery views`);
      if (!typeHasVisual(slide.layout, 'drawing')) fail(`Slide ${slide.id}: vector requires ${DRAWING_TYPES} layout`);
      const groups = selected.asset.metadata.svgGroups;
      try {
        validateVectorStages(result.stages, selected.asset.metadata.svgGroupIds ?? [], groups ? groups.filter(group => group.stroked).map(group => group.id) : null);
        if (checkRevealParts) validateDrawingParts(result.stages, selected.asset.metadata);
      }
      catch (error) { fail(`Slide ${slide.id}: ${error.message}`); }
      result.vector = { itemId: selected.id, alt: text(slide.vector.alt ?? '', 'vector alt') };
      for (const stage of result.stages) if (stage.svgGroupIds !== undefined) stage.svgGroupIds = [...stage.svgGroupIds];
    } else {
      if (result.stages.some(stage => stage.svgGroupIds !== undefined)) fail(`Slide ${slide.id}: SVG group mappings require a vector composition`);
      for (const stage of result.stages) staged(stage, () => validateTextStage(stage));
    }
    // Layout primitives: this slide's overrides of the deck defaults.
    const design = validatePrimitives(slide.design, `Slide ${slide.id}: design`, `Slide ${slide.id}: design.`);
    for (const name of ['copy', 'stageText']) if (design[name]?.position && !slideHasVisual(result))
      fail(`Slide ${slide.id}: design.${name}.position needs a visual (media on a text-media or full-media slide, a vector or a gallery)`);
    if (Object.keys(design).length) result.design = design;
    validateSlideTiming(result, effectiveSlideDesign(deckDesign, design));
    const before = setBy === null ? null : saved.get(slide.id);
    const candidates = validateCandidates(slide, before, result, { item, fail, text, saving: setBy !== null });
    if (candidates.length) result.candidates = candidates;
    const pickSetBy = setBy === null ? recordedSetter(slide, fail)
      : (before ? pickKey(before) !== pickKey(result) : slidePicks(result).length > 0) ? setBy : before?.pickSetBy;
    if (pickSetBy) result.pickSetBy = pickSetBy;
    return result;
  });
}
const DRAWING_TYPES = (names => `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`)(SLIDE_TYPE_NAMES.filter(name => typeHasVisual(name, 'drawing')));
const pickKey = slide => JSON.stringify(slidePicks(slide));
function recordedSetter(slide, fail) {
  if (slide.pickSetBy == null) return undefined;
  if (!PICK_SETTERS.includes(slide.pickSetBy)) fail(`Slide ${slide.id}: pickSetBy must be creator or agent`);
  return slide.pickSetBy;
}
// One slide's unpicked candidates. `result` holds the slide's validated picks; `before` is the saved
// slide when this is a save.
function validateCandidates(slide, before, result, { item, fail, text, saving }) {
  const picks = slidePicks(result);
  if (slide.candidates != null && !Array.isArray(slide.candidates)) fail(`Slide ${slide.id}: candidates must be an array of {itemId, alt, label}`);
  // Omitted on a save: the saved list stays, less anything this save picks (starring moves it out).
  const supplied = slide.candidates != null || !saving;
  const values = supplied ? slide.candidates ?? [] : (before?.candidates ?? []).filter(value => !picks.includes(value.itemId));
  const seen = new Set();
  const candidates = values.map(value => {
    if (!value || typeof value !== 'object' || typeof value.itemId !== 'string' || !value.itemId) fail(`Slide ${slide.id}: each candidate needs an itemId`);
    const found = item(value.itemId);
    if (seen.has(found.id)) fail(`Slide ${slide.id}: candidate ${found.id} is listed twice`);
    seen.add(found.id);
    if (picks.includes(found.id)) fail(`Slide ${slide.id}: candidate ${found.id} is also the slide's pick; a starred asset is saved in media, vector or subnav only`);
    if (!visualKind(found)) fail(`Slide ${slide.id}: candidate ${found.id} is ${found.asset?.kind ?? 'not media'}; candidates are images, video or SVG drawings`);
    const label = value.label == null ? '' : text(value.label, 'candidate label');
    return { itemId: found.id, alt: text(value.alt ?? '', 'candidate alt'), ...(label.trim() ? { label } : {}) };
  });
  // A starred candidate is never removed: a supplied list must keep each saved pick, picked or unpicked.
  if (saving && supplied && before) for (const itemId of slidePicks(before))
    if (!picks.includes(itemId) && !seen.has(itemId)) fail(`Slide ${slide.id}: ${itemId} is starred on this slide and cannot be removed; star another or keep it in candidates, then remove it`);
  return candidates;
}

// Deck design (spec #44). `theme` holds per-deck colour and font roles; a role with no deck
// value follows the channel's Brand Standards at build time, then the template default.
// setBy is recorded by the save path (creator = Slides/human route, agent = save_deck), never
// taken from the request; a supplied setBy is accepted for round-trips and ignored.
export const THEME_COLOR_ROLES = Object.freeze(['base', 'accent', 'background']);
export const THEME_FONT_ROLES = Object.freeze(['base', 'accent', 'alternate']);
export const TEMPLATE_COLORS = Object.freeze({ base: '#252C30', accent: '#26686B', background: '#F7F4ED' });
export const TEMPLATE_FONT = 'Manrope';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// Layout primitives (spec #44): bounded arguments only, deck defaults with per-slide overrides.
// An enum lists its values; a number range is [min, max]; 'boolean' is true or false.
const SIDES = ['top', 'bottom', 'left', 'right'], ALIGNS = ['start', 'center', 'end'];
export const STAGE_TEXT_STYLES = Object.freeze(['chips', 'steps', 'list', 'card']);
export const DESIGN_PRIMITIVES = Object.freeze({
  copy: { position: SIDES, align: ALIGNS, valign: ALIGNS },
  stageText: { style: STAGE_TEXT_STYLES, position: SIDES, align: ALIGNS, valign: ALIGNS, numbered: 'boolean', flipMs: [0, 2000] },
  type: { scale: ['compact', 'standard', 'large'] },
  spacing: { density: ['compact', 'standard', 'spacious'] },
  timing: { betweenMs: [0, 60000] },
});
const PRIMITIVE_NAMES = Object.keys(DESIGN_PRIMITIVES);
/** Validates layout primitives. Refusals name the deck or slide (`whole`, e.g. "Slide s1: design"),
 *  the primitive and the argument; `at` prefixes the field ("Deck design: " or "Slide s1: design.").
 *  Unset (absent or null) arguments are dropped, and so is a primitive left with none. */
export function validatePrimitives(value, whole, at) {
  if (value == null) return {};
  if (!plain(value)) throw new Error(`${whole} must be an object of ${PRIMITIVE_NAMES.join(', ')}`);
  const result = {};
  for (const [name, args] of Object.entries(value)) {
    const spec = DESIGN_PRIMITIVES[name];
    if (!spec) throw new Error(`${at}${name} is not supported; use ${PRIMITIVE_NAMES.join(', ')}`);
    if (args == null) continue;
    if (!plain(args)) throw new Error(`${at}${name} must be an object of ${Object.keys(spec).join(', ')}`);
    const kept = {};
    for (const [arg, entry] of Object.entries(args)) {
      const allowed = spec[arg], field = `${at}${name}.${arg}`;
      if (!allowed) throw new Error(`${field} is not supported; use ${Object.keys(spec).join(', ')}`);
      if (entry == null) continue;
      if (allowed === 'boolean') { if (typeof entry !== 'boolean') throw new Error(`${field} must be true or false`); }
      else if (typeof allowed[0] === 'number') { if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < allowed[0] || entry > allowed[1]) throw new Error(`${field} must be a number from ${allowed[0]} to ${allowed[1]}`); }
      else if (!allowed.includes(entry)) throw new Error(`${field} must be one of ${allowed.join(', ')}`);
      kept[arg] = entry;
    }
    if (Object.keys(kept).length) result[name] = kept;
  }
  return result;
}
/** Effective primitives for one slide: per argument, the slide's value, else the deck's, else unset
 *  (the template default). A deck default position is dropped on a slide without a visual. */
export function effectiveSlideDesign(deckDesign = {}, slideDesign = {}, { hasVisual = true } = {}) {
  const result = {};
  for (const name of PRIMITIVE_NAMES) {
    const merged = { ...deckDesign?.[name], ...slideDesign?.[name] };
    if (!hasVisual) delete merged.position;
    if (Object.keys(merged).length) result[name] = merged;
  }
  return result;
}
// A visual is what the build places text around: rendered media, a vector or a gallery.
export const slideHasVisual = slide => Boolean(slide.vector || slide.subnav?.length || (slide.media && typeHasVisual(slide.layout, 'image')));
/** With a slide-wide gap, every stage after the first starts timing.betweenMs after the previous
 *  stage's motion ends, so its own afterMs, holdMs and a manual trigger are refused. */
export function validateSlideTiming(slide, design) {
  if (design.timing?.betweenMs == null) return;
  for (const stage of (slide.stages ?? []).slice(1)) for (const key of ['afterMs', 'holdMs', 'trigger']) {
    if (stage[key] == null || (key === 'trigger' && stage[key] === 'auto')) continue;
    throw new Error(`Slide ${slide.id}: Stage ${stage.id ?? stage.title}: ${key === 'trigger' ? 'trigger manual' : key} conflicts with timing.betweenMs, which starts every stage after the first; remove it`);
  }
}
const DESIGN_KEYS = ['theme', ...PRIMITIVE_NAMES];
function themeRoles(value, roles, name, check) {
  if (value == null) return {};
  if (!plain(value)) throw new Error(`Deck design: theme.${name} must be an object of ${roles.join(', ')}`);
  const result = {};
  for (const [role, entry] of Object.entries(value)) {
    if (!roles.includes(role)) throw new Error(`Deck design: theme.${name}.${role} is not supported; use ${roles.join(', ')}`);
    if (entry !== null) result[role] = check(entry, `theme.${name}.${role}`);
  }
  return result;
}
const hexColor = (value, name) => {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Deck design: ${name} must be a six-digit hex colour (for example #1255FF)`);
  return value.toUpperCase();
};
/** Validates a saved deck design. `previous` is the stored design; `setBy` is creator|agent,
 *  or null to restore a stored design (undo) with its recorded setBy. An unchanged value keeps
 *  its recorded setBy; a removed role (absent or null) returns to Brand Standards. */
export function validateDeckDesign(design, { previous = {}, setBy = null } = {}) {
  if (design == null) return emptyDesign();
  if (!plain(design)) throw new Error('Deck design must be an object');
  for (const key of Object.keys(design)) if (!DESIGN_KEYS.includes(key)) throw new Error(`Deck design: ${key} is not supported; use ${DESIGN_KEYS.join(', ')}`);
  const theme = design.theme ?? {};
  if (!plain(theme)) throw new Error('Deck design: theme must be an object of colors, fonts');
  for (const key of Object.keys(theme)) if (!['colors', 'fonts', 'setBy'].includes(key)) throw new Error(`Deck design: theme.${key} is not supported; use colors, fonts`);
  const font = (value, name) => {
    if (typeof value !== 'string' || !fontForFamily(value)) throw new Error(`Deck design: ${name} must be a supported font family`);
    return value;
  };
  const colors = themeRoles(theme.colors, THEME_COLOR_ROLES, 'colors', hexColor);
  const fonts = themeRoles(theme.fonts, THEME_FONT_ROLES, 'fonts', font);
  const prior = previous?.theme ?? {}, recorded = setBy === null ? theme.setBy : null;
  const sources = (values, kind) => Object.fromEntries(Object.entries(values).map(([role, value]) => {
    if (setBy === null) {
      const source = recorded?.[kind]?.[role];
      if (!['creator', 'agent'].includes(source)) throw new Error(`Deck design: theme.setBy.${kind}.${role} must be creator or agent`);
      return [role, source];
    }
    const kept = prior[kind]?.[role] === value ? prior.setBy?.[kind]?.[role] : null;
    return [role, kept ?? setBy];
  }));
  const { theme: _theme, ...primitives } = design;
  return { theme: { colors, fonts, setBy: { colors: sources(colors, 'colors'), fonts: sources(fonts, 'fonts') } }, ...validatePrimitives(primitives, 'Deck design', 'Deck design: ') };
}
export const emptyDesign = () => ({ theme: { colors: {}, fonts: {}, setBy: { colors: {}, fonts: {} } } });
/** Effective theme for a build: deck value, else the channel's current Brand Standards role,
 *  else the template default. Each role records its value and source (deck|channel|template);
 *  deck and channel roles also record setBy (a channel role is creator-set by definition). */
export function effectiveDeckTheme(standards, design) {
  const theme = design?.theme ?? {};
  const resolve = (kind, roles, channel, template) => Object.fromEntries(roles.map(role => {
    if (theme[kind]?.[role] != null) return [role, { value: theme[kind][role], source: 'deck', setBy: theme.setBy?.[kind]?.[role] ?? 'creator' }];
    if (channel?.[role] != null) return [role, { value: channel[role], source: 'channel', setBy: 'creator' }];
    return [role, { value: template(role), source: 'template' }];
  }));
  return {
    colors: resolve('colors', THEME_COLOR_ROLES, standards?.colorRoles, role => TEMPLATE_COLORS[role]),
    fonts: resolve('fonts', THEME_FONT_ROLES, standards?.fontRoles, () => TEMPLATE_FONT),
  };
}
/** Build inputs from an effective theme: role values in role order, null where the template applies. */
export const themeBuildValues = (effective) => ({
  colors: Object.fromEntries(THEME_COLOR_ROLES.map(role => [role, effective.colors[role].source === 'template' ? null : effective.colors[role].value])),
  fonts: THEME_FONT_ROLES.map(role => effective.fonts[role].source === 'template' ? null : effective.fonts[role].value),
});
