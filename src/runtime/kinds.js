// One explicit registry. Entries name template branches and allowed app operations;
// definitions and handlers remain owned by the existing scoped services.
import { RuntimeError } from './validate.js';

export const SHARED_TOOLS = Object.freeze([
  'inspect_image', 'inspect_contact_sheet', 'inspect_media', 'read_reference_excerpt',
  'search_project', 'register_work_file', 'reuse_project_item', 'get_capabilities',
  'get_context', 'read_conversation_history',
]);
export const KIND_REGISTRY = Object.freeze({
  video: Object.freeze({ templates: 'video', tools: Object.freeze([
    'get_operation_guide', 'update_story', 'update_cards', 'validate_render', 'create_draft',
    'declare_final_request', 'create_final', 'get_job', 'await_job', 'cancel_job',
    'move_final_to_drafts', 'list_graphic_recipes', 'get_graphic_recipe',
    'create_graphic_recipe', 'update_graphic_recipe', 'render_graphic',
    'list_branding', 'promote_card', 'apply_branding',
  ]) }),
  deck: Object.freeze({ templates: 'deck', tools: Object.freeze(['update_story', 'read_deck', 'save_deck', 'build_deck', 'get_job', 'await_job', 'cancel_job']) }),
});

export function resolveKind(production, registry = KIND_REGISTRY) {
  const kind = production.kind === undefined ? 'video' : production.kind;
  if (!Object.hasOwn(registry, kind)) throw new RuntimeError('UNSUPPORTED_KIND', `Unsupported production kind: ${String(kind)}`);
  return kind;
}

export function selectKindTools(tools, kind, { supportsImages = true, registry = KIND_REGISTRY } = {}) {
  const entry = registry[resolveKind({ kind }, registry)];
  const allowed = new Set([...SHARED_TOOLS, ...entry.tools]);
  const definitions = tools.definitions.filter(({ name }) => allowed.has(name) &&
    (supportsImages || !['inspect_image', 'inspect_contact_sheet'].includes(name))).map((definition) => {
    if (kind === 'video' || !['register_work_file', 'reuse_project_item'].includes(definition.name)) return definition;
    // The shared library operation stays available; video card assignment does not.
    const properties = Object.fromEntries(Object.entries(definition.inputSchema.properties).filter(([name]) => !['cardId', 'expectedRevision', 'assign'].includes(name)));
    return { ...definition, inputSchema: { ...definition.inputSchema, properties } };
  });
  const served = new Set(definitions.map(({ name }) => name));
  return {
    definitions,
    async call(name, args = {}) {
      if (!served.has(name)) throw new RuntimeError('UNKNOWN_TOOL', `Tool unavailable for this request: ${String(name)}`, { status: 404 });
      if (kind !== 'video' && ['register_work_file', 'reuse_project_item'].includes(name) &&
          ['cardId', 'expectedRevision', 'assign'].some((key) => Object.hasOwn(args, key)))
        throw new RuntimeError('INVALID_ARGUMENT', 'Video card assignment is unavailable for this production kind');
      return tools.call(name, args);
    },
  };
}
