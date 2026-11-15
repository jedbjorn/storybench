// App-only completion hook. Symbols never enter native schemas or serialized tool results.
// Adapters acknowledge only after writing the complete successful response to the harness.
export const TOOL_DELIVERED = Symbol.for('storybench.toolDelivered');
export function withToolDelivery(value, callback) {
  if (callback) Object.defineProperty(value, TOOL_DELIVERED, { value: callback });
  return value;
}
