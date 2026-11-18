// Internal to public/ui: a radio group laid out on a grid with one Tab stop. Arrow keys move to the
// cell `next(key, from)` names, choosing it as they go; Enter or Space chooses the focused cell.
export function createChoiceGrid({ className, label, cells, value = null, next, onChange, doc }) {
  const element = doc.createElement('div');
  element.className = className;
  element.setAttribute('role', 'radiogroup');
  element.setAttribute('aria-label', label);
  const buttons = new Map(cells.map((cell) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', cell.label);
    button.title = cell.label;
    button.dataset.value = cell.value;
    button.style.gridArea = `${cell.row + 1} / ${cell.col + 1}`;
    button.append(cell.content ?? '');
    button.addEventListener('click', () => choose(cell.value));
    button.addEventListener('keydown', (event) => {
      const target = next(event.key, cell.value);
      if (target === undefined) return;
      event.preventDefault();
      if (target === null) return;
      choose(target); buttons.get(target).focus();
    });
    return [cell.value, button];
  }));
  function paint() {
    const stop = buttons.has(value) ? value : cells[0].value;
    for (const [key, button] of buttons) {
      button.setAttribute('aria-checked', String(key === value));
      button.tabIndex = key === stop ? 0 : -1;
    }
  }
  function choose(key) {
    if (key === value) return;
    value = key; paint(); onChange(key);
  }
  element.append(...buttons.values());
  paint();
  return {
    element,
    get value() { return value; },
    set value(key) { value = key; paint(); },
    focus() { buttons.get(buttons.has(value) ? value : cells[0].value).focus(); },
  };
}
