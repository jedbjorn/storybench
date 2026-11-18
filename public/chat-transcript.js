import { animateHaloSun } from './chat-halo.js';
import { selectStatus } from './turn-phases.js';

// The turn timer: m:ss, minutes uncapped.
export const clock = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// Owns only the selected conversation's DOM and scroll/animation lifetime.
export class ChatTranscript {
  constructor(scroller, jump, kind) {
    Object.assign(this, { scroller, jump, kind });
    this.view = scroller.ownerDocument.defaultView;
    this.following = true;
    this.nodes = new Map();
    this.content = scroller.ownerDocument.createElement('div');
    this.content.className = 'chat-transcript';
    scroller.replaceChildren(this.content);
    jump.hidden = true;
    this.events = new this.view.AbortController();
    const listen = (node, type, callback, options = {}) => node.addEventListener(type, callback, { ...options, signal: this.events.signal });
    listen(jump, 'click', () => {
      this.resume();
      scroller.focus({ preventScroll: true });
    });
    listen(scroller, 'wheel', event => { if (event.deltaY < 0) this.pause(); }, { passive: true });
    listen(scroller, 'touchstart', event => { this.touchY = event.touches[0]?.clientY; }, { passive: true });
    listen(scroller, 'touchmove', event => {
      const y = event.touches[0]?.clientY;
      if (y > this.touchY) this.pause();
      this.touchY = y;
    }, { passive: true });
    listen(scroller, 'keydown', event => {
      if (event.target !== scroller) return;
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) this.pause();
    });
    listen(scroller, 'scroll', () => {
      // Programmatic writes record their resulting position synchronously. A
      // resize/clamp is layout, not upward intent (including scrollbar drags).
      if (this.height !== scroller.scrollHeight || this.viewport !== scroller.clientHeight) return this.layout();
      if (scroller.scrollTop < this.top - 1) this.pause();
      // Returning to the end by any means resumes following, as Jump to end does.
      else if (!this.following && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 2) return this.resume();
      this.remember();
    }, { passive: true });
    listen(scroller, 'load', () => this.layout(), { capture: true });
    if (this.view.ResizeObserver) {
      this.observer = new this.view.ResizeObserver(() => this.layout());
      this.observer.observe(this.content);
      this.observer.observe(scroller);
    }
    this.remember();
  }

  pause() {
    if (!this.following) return;
    this.following = false;
    this.jump.hidden = false;
    this.remember();
  }

  resume() {
    this.following = true;
    this.jump.hidden = true;
    this.layout();
  }

  remember() {
    const { scroller } = this;
    this.top = scroller.scrollTop;
    this.height = scroller.scrollHeight;
    this.viewport = scroller.clientHeight;
    const edge = scroller.getBoundingClientRect().top;
    this.anchor = [...this.content.children].find(node => node.getBoundingClientRect().bottom > edge);
    this.anchorOffset = this.anchor ? this.anchor.getBoundingClientRect().top - edge : 0;
  }

  layout() {
    if (this.disposed) return;
    const { scroller } = this;
    if (this.following) scroller.scrollTop = scroller.scrollHeight;
    else if (this.anchor?.isConnected) {
      scroller.scrollTop += this.anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - this.anchorOffset;
    } else scroller.scrollTop = this.top;
    this.remember();
  }

  // `status`: { events, state, startedAt, offset } from the latest poll; offset maps this clock to the server's.
  render(items, active, status = null) {
    this.status = status;
    const keys = new Set(items.map(item => item.key));
    for (const [key, entry] of this.nodes) {
      if (!keys.has(key)) { entry.node.remove(); this.nodes.delete(key); }
    }
    let previous = null;
    for (const { key, html } of items) {
      let entry = this.nodes.get(key);
      if (!entry) {
        const template = this.scroller.ownerDocument.createElement('template');
        template.innerHTML = html;
        entry = { node: template.content.firstElementChild, html };
        this.nodes.set(key, entry);
      } else if (entry.html !== html) {
        const template = this.scroller.ownerDocument.createElement('template');
        template.innerHTML = html;
        const replacement = template.content.firstElementChild;
        if (this.anchor === entry.node) this.anchor = replacement;
        entry.node.replaceWith(replacement);
        entry.node = replacement;
        entry.html = html;
      }
      const next = previous ? previous.nextSibling : this.content.firstChild;
      if (next !== entry.node) this.content.insertBefore(entry.node, next);
      previous = entry.node;
    }
    if (active && !this.animation) {
      this.animation = this.scroller.ownerDocument.createElement('div');
      this.animation.className = 'chat-response-animation';
      this.animation.setAttribute('role', 'status');
      // The status region announces the phase label only; the timer is never read out.
      this.animation.innerHTML = '<canvas width="900" height="900" aria-hidden="true"></canvas><div class="chat-turn-status"><span data-turn-label></span><span data-turn-timer aria-hidden="true"></span></div>';
      this.content.append(this.animation);
      this.stopAnimation = animateHaloSun(this.animation.querySelector('canvas'), this.kind);
      this.shown = null;
      this.ticker = this.view.setInterval(() => this.paintStatus(), 500);
    } else if (!active && this.animation) {
      this.stopAnimation();
      this.view.clearInterval(this.ticker);
      this.animation.remove();
      this.animation = null;
      this.stopAnimation = null;
    }
    if (this.animation) this.paintStatus();
    this.layout();
  }

  // Re-run the selection rule between polls too, so the dwell ends and the timer counts on time.
  paintStatus() {
    const { events = [], state = 'running', startedAt = null, offset = 0 } = this.status ?? {};
    const now = Date.now() + offset;
    this.shown = selectStatus({ events, state, now, kind: this.kind, shown: this.shown });
    const label = this.animation.querySelector('[data-turn-label]'), timer = this.animation.querySelector('[data-turn-timer]');
    const start = Date.parse(startedAt), time = Number.isFinite(start) ? ` · ${clock(now - start)}` : '';
    if (label.textContent !== this.shown.label) label.textContent = this.shown.label;
    if (timer.textContent !== time) timer.textContent = time;
  }

  destroy() {
    this.disposed = true;
    this.stopAnimation?.();
    this.view.clearInterval(this.ticker);
    this.observer?.disconnect();
    this.events.abort();
    this.scroller.replaceChildren();
    this.jump.hidden = true;
  }
}
