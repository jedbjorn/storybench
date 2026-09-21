// Chooses the conversation persistence (settings, segments, production runs) for a store.
// The v9 schema (DATA lane, `feat/schema-v9`) provides typed accessors; until they are
// present this returns null and the chat keeps the legacy single-Codex behaviour.
export function conversationPersistenceFor(store) {
  if (typeof store?.createProductionRun !== "function") return null;
  // Wired to the v9 accessors once they land (see _run/evidence/v9/API.md).
  return null;
}
