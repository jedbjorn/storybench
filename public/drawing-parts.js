// Registration describes which source groups the build can wrap as reveals. Null means the
// registered source could not be checked. Older metadata without a profile keeps its group list.
export function drawingParts(metadata) {
  const parts = metadata?.svgRevealGroupIds === undefined ? metadata?.svgGroupIds : metadata.svgRevealGroupIds;
  return Array.isArray(parts) ? parts : null;
}

function ancestorsOf(metadata, id) {
  const ancestors = metadata?.svgRevealAncestors ?? {};
  return Object.hasOwn(ancestors, id) ? ancestors[id] : [];
}

export function unclaimedDrawingParts(metadata, claimed) {
  const ancestors = new Set([...claimed].flatMap(id => ancestorsOf(metadata, id)));
  return (drawingParts(metadata) ?? []).filter(id => !claimed.has(id) && !ancestors.has(id) &&
    !ancestorsOf(metadata, id).some(parent => claimed.has(parent)));
}

// Both the editor's assignment draft and explicit saves use the same source restrictions.
export function validateDrawingParts(stages, metadata) {
  const parts = drawingParts(metadata);
  if (!parts) throw new Error('Drawing parts are unavailable. Check the registered drawing or choose another.');
  const mapped = new Set(stages.flatMap(stage => stage.svgGroupIds ?? []));
  for (const stage of stages) {
    for (const id of [...(stage.svgGroupIds ?? []), ...(stage.changes ?? []).map(change => change.groupId)]) {
      if (!parts.includes(id)) throw new Error(`Stage ${stage.id}: SVG group ${id} must be independent visible geometry; definitions and reused groups cannot be revealed`);
      if (ancestorsOf(metadata, id).some(parent => mapped.has(parent)))
        throw new Error(`Stage ${stage.id}: SVG group ${id} cannot nest inside another mapped group`);
    }
  }
}
