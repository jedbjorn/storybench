// Conversation persistence (settings, segments, production requests) on the schema v9 store
// accessors. Implements the interface documented in conversation-runtime.js; the store owns
// every rule it enforces (idle guard, optimistic settings revision, single native session per
// segment, request transitions and Final intent).
export function createV9ConversationPersistence(store) {
  const settingsOf = (conversation) => ({ harness: conversation.harness, model: conversation.model, effort: conversation.effort,
    source: conversation.settingsSource, revision: conversation.settingsRevision, updatedAt: conversation.settingsUpdatedAt });
  const segmentOf = (segment) => segment && { ...segment, seedIncluded: segment.seedIncludedMessages, seedOmitted: segment.seedOmittedMessages };
  return {
    getSettings: (conversationId) => settingsOf(store.requireConversation(conversationId)),
    // A new conversation is preselected with the last explicit choice (an explicit selection).
    initSettings(conversationId, value) {
      const current = store.requireConversation(conversationId);
      if (value.source !== "explicit-inherited") return settingsOf(current);
      return settingsOf(store.updateConversationSettings(conversationId, current.settingsRevision, { harness: value.harness, model: value.model ?? null, effort: value.effort ?? null }));
    },
    saveSettings: (conversationId, value, { expectedRevision }) =>
      settingsOf(store.updateConversationSettings(conversationId, expectedRevision, { harness: value.harness, model: value.model ?? null, effort: value.effort ?? null })),
    lastExplicitSettings: () => store.lastExplicitSettings(),
    activeSegment: (conversationId) => segmentOf(store.getActiveSegment(conversationId)),
    listSegments: (conversationId) => store.listSegments(conversationId).map(segmentOf),
    createSegment({ id = null, conversationId, harness, reason, previousSegmentId, firstMessageId = null, seedIncluded = null, seedOmitted = null, nativeSessionId = null, exceptRunId = null }) {
      const segment = store.createSegment({ ...(id ? { id } : {}), conversationId, harness, reason, ...(previousSegmentId !== undefined ? { previousSegmentId } : {}),
        firstMessageId, seedIncludedMessages: seedIncluded, seedOmittedMessages: seedOmitted, exceptRunId });
      return segmentOf(nativeSessionId ? store.setSegmentNativeSession(segment.id, nativeSessionId) : segment);
    },
    setSegmentSession: (segmentId, nativeSessionId) => store.setSegmentNativeSession(segmentId, nativeSessionId),
    updateSegmentSeed: (segmentId, seed) => store.updateSegmentSeed(segmentId, { firstMessageId: seed.firstMessageId, seedIncludedMessages: seed.seedIncluded, seedOmittedMessages: seed.seedOmitted }),
    activeRuns: (conversationId) => store.listProductionRuns({ conversationId, states: ["starting", "running"] }),
    createRun(run) {
      return store.createProductionRun({ id: run.id, conversationId: run.conversationId, kind: run.kind ?? "chat", origin: run.origin ?? "typed",
        clientRequestId: run.clientRequestId ?? null, targetCardId: run.targetCardId ?? null, originatingMessageId: run.userMessageId ?? null,
        segmentId: run.segmentId ?? null, harness: run.harness, modelSelected: run.modelSelected ?? null, effortSelected: run.effortSelected ?? null }).run;
    },
    updateRun(id, patch) {
      const { finishedAt, ...changes } = patch;
      return store.updateProductionRun(id, changes);
    },
    listRuns: (conversationId) => store.listProductionRuns({ conversationId }),
  };
}

// The persistence for a store: the v9 accessors when present, else none (legacy Codex path).
export function conversationPersistenceFor(store) {
  if (typeof store?.createProductionRun !== "function" || typeof store?.createSegment !== "function") return null;
  return createV9ConversationPersistence(store);
}
