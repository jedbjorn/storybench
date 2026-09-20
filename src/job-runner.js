import { createHash } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function renderFingerprint(snapshot) {
  return createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex");
}

export class HeavyJobQueue {
  constructor() {
    this.pending = [];
    this.active = null;
    this.closed = false;
    this.draining = null;
  }

  assertOpen() {
    if (this.closed) throw new Error("Heavy job worker is closed");
  }

  enqueue(id, run, onCancel = () => {}, onError = () => {}) {
    this.assertOpen();
    if (this.active?.id === id || this.pending.some((item) => item.id === id))
      throw new Error(`Heavy job already queued: ${id}`);
    let settle;
    const done = new Promise((resolve) => { settle = resolve; });
    this.pending.push({ id, run, onCancel, onError, settle });
    this.#drain();
    return done;
  }

  cancel(id, reason = "Job cancelled") {
    if (this.active?.id === id) {
      this.active.reason = reason;
      this.active.controller.abort(new DOMException(reason, "AbortError"));
      return "active";
    }
    const index = this.pending.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [item] = this.pending.splice(index, 1);
    item.onCancel(reason);
    item.settle();
    return "queued";
  }

  async close(reason = "Job cancelled during server shutdown") {
    this.closed = true;
    for (const item of this.pending.splice(0)) {
      item.onCancel(reason);
      item.settle();
    }
    if (this.active) {
      this.active.reason = reason;
      this.active.controller.abort(new DOMException(reason, "AbortError"));
    }
    await this.draining;
  }

  #drain() {
    if (this.draining) return;
    this.draining = (async () => {
      while (!this.closed && this.pending.length) {
        const item = this.pending.shift();
        const controller = new AbortController();
        this.active = { id: item.id, controller, reason: null };
        try { await item.run(controller.signal); }
        catch (error) { await item.onError(error); }
        finally { this.active = null; item.settle(); }
      }
    })().finally(() => {
      this.draining = null;
      if (!this.closed && this.pending.length) this.#drain();
    });
  }
}
