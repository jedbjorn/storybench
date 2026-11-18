// Selection surface: makes every [data-select="<key>"] inside `root` selectable. Hover and selection
// show outlines; click, Enter or Space selects; a click on empty surface or Escape deselects. While
// focus is inside the surface, Escape is handled here and does not reach other Escape handlers.
export function createSelectionSurface(root, { onChange = () => {} } = {}) {
  const win = root.ownerDocument.defaultView;
  let selected = null;
  const items = () => [...root.querySelectorAll('[data-select]')];
  const find = (key) => items().find((node) => node.dataset.select === key) || null;
  function paint() {
    for (const node of items()) {
      node.classList.add('sb-selectable');
      node.setAttribute('role', 'button');
      if (!node.hasAttribute('tabindex')) node.tabIndex = 0;
      if (node.dataset.selectLabel) node.setAttribute('aria-label', node.dataset.selectLabel);
      node.setAttribute('aria-pressed', String(node.dataset.select === selected));
    }
  }
  function select(key) {
    const next = key != null && find(String(key)) ? String(key) : null;
    if (next === selected) return paint();
    selected = next; paint();
    const element = next && find(next);
    onChange(selected, element);
    root.dispatchEvent(new win.CustomEvent('sb-selectionchange', { bubbles: true, detail: { key: selected, element } }));
  }
  const itemOf = (target) => {
    const item = target.closest?.('[data-select]');
    return item && item !== root && root.contains(item) ? item : null;
  };
  const click = (event) => select(itemOf(event.target)?.dataset.select ?? null);
  const keydown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return select(null); }
    const item = itemOf(event.target);
    if (!item || item !== event.target || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault(); select(item.dataset.select);
  };
  root.classList.add('sb-surface');
  root.addEventListener('click', click);
  root.addEventListener('keydown', keydown);
  paint();
  return {
    get selected() { return selected; },
    select,
    // Call after re-rendering the surface's content: new items become selectable and a vanished
    // selection clears.
    refresh() { select(selected); },
    destroy() { root.removeEventListener('click', click); root.removeEventListener('keydown', keydown); },
  };
}
