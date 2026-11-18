// Saved composition data, shared by manual editing and runtime tools. No executable markup.
export const DECK_LAYOUTS = ['title', 'section', 'statement', 'text-media', 'columns', 'full-media', 'process'];
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
      if (!['title', 'text-media', 'full-media', 'process'].includes(slide.layout)) fail(`Slide ${slide.id}: vector requires title, text-media, full-media or process layout`);
      const groups = selected.asset.metadata.svgGroups;
      try { validateVectorStages(result.stages, selected.asset.metadata.svgGroupIds ?? [], groups ? groups.filter(group => group.stroked).map(group => group.id) : null); }
      catch (error) { fail(`Slide ${slide.id}: ${error.message}`); }
      result.vector = { itemId: selected.id, alt: text(slide.vector.alt ?? '', 'vector alt') };
      for (const stage of result.stages) if (stage.svgGroupIds !== undefined) stage.svgGroupIds = [...stage.svgGroupIds];
    } else {
      if (result.stages.some(stage => stage.svgGroupIds !== undefined)) fail(`Slide ${slide.id}: SVG group mappings require a vector composition`);
      for (const stage of result.stages) staged(stage, () => validateTextStage(stage));
    }
    return result;
  });
}
