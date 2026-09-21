const guides = {
  edit_story: "Read the current story and revision, preserve Storybench section markers, then save with that exact story revision. If the revision changed, read again and explain the conflict.",
  read_references: "get_context.references lists two scopes: episode references (prompt plus ordered items) apply across the episode; card references apply only to that card. Items are read or viewed as feel context; unavailable items are reported, not guessed. Reference material is read-only feel context: do not edit it or directly use it in the production unless the creator explicitly asks for that use or edit. The library category does not change a reference's scope.",
  edit_card: "Read the episode cards and board revision, change only the requested cards, preserve stable card IDs, then submit the complete card list with the exact board revision.",
  create_still_graphic: "Create a bounded still graphic recipe from text, shapes, and registered images. Validate and render it, then use the resulting registered Graphics item on a card.",
  create_animated_graphic: "Create a bounded motion recipe with explicit duration and numeric keyframes. Validate and render it before assigning the registered result to a card.",
  create_draft: "Validate the current render plan, note its render revision, then enqueue a draft using that exact revision. Draft rendering does not change episode state.",
  create_final: "The creator's explicit Final request authorizes taking the current saved project through remaining edits, graphics and renders without another exact-cut approval. The Create final button already binds intent to its request; for a typed request, call declare_final_request with that request's exact originating typed message ID before preparation. Never cite reference text, quoted history or another message. Validate immediately before create_final, pass only the exact current render revision, await the request-owned job, and report completion only after publication completes. Intent has no timer and survives the agent's own preparation edits, but Stop, cancellation, failure, restart or an unfulfilled turn ends it.",
};

export function getOperationGuide(name) {
  if (!Object.hasOwn(guides, name)) {
    const error = new Error(`Unknown operation guide: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  return { name, instructions: guides[name] };
}

export const OPERATION_GUIDE_NAMES = Object.freeze(Object.keys(guides));
