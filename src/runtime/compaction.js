// Chat context compaction policy, after Subfloor's threshold + idle compaction (its
// docs/conversation-runtime.md). One table, read by the chat service and its projection.
//  - trigger: the context size (input side of one model request) at which the chat is
//    compacted. It is passed to the harness (Claude `--autocompact`, Codex
//    `model_auto_compact_token_limit`) and checked again after each turn.
//  - idleMinTokens / idleAfterMs: an idle chat at or above this size is compacted once
//    after the wait, while the provider's prompt cache (cacheLifeMs) is still warm, so the
//    next message does not re-read a large cold context.
// Defaults are by model family: Anthropic models 500k / 125k, OpenAI models 225k / 125k.
// Other routes (OpenCode providers) show the meter only and cannot be compacted.
const MINUTE = 60_000;
const POLICIES = Object.freeze({
  anthropic: Object.freeze({ family: "anthropic", trigger: 500_000, idleMinTokens: 125_000, idleAfterMs: 50 * MINUTE, cacheLifeMs: 60 * MINUTE }),
  openai: Object.freeze({ family: "openai", trigger: 225_000, idleMinTokens: 125_000, idleAfterMs: 25 * MINUTE, cacheLifeMs: 45 * MINUTE }),
});

// Harnesses whose stored session Storybench can ask to compact.
export const COMPACTING_HARNESSES = Object.freeze(["claude", "codex"]);

// The policy for a conversation's selection, or null when it has no automatic compaction.
// Claude runs only Anthropic models and Codex only OpenAI models, so the harness names the
// family. Only these two harnesses can be asked to compact a stored session.
export function compactionPolicy(selection = {}) {
  return selection.harness === "claude" ? POLICIES.anthropic : selection.harness === "codex" ? POLICIES.openai : null;
}

// Claude's --autocompact accepts 100k to 1M.
export const claudeAutocompact = (trigger) => Number.isInteger(trigger) && trigger >= 100_000 && trigger <= 1_000_000 ? trigger : null;

// Context size of one Anthropic request: every input token the model read.
export const anthropicContext = (usage) => usage ? (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : null;
