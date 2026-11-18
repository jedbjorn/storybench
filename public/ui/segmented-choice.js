// Segmented choice: a small set of mutually exclusive options shown as one row of buttons; the chosen
// one is pressed. `value` may be null (nothing chosen yet). Each option is a normal button, so Tab
// reaches it and Enter or Space chooses it.
export function createSegmentedChoice({ label, options, value = null, onChange = () => {}, doc = document }) {
  const element = doc.createElement('div');
  element.className = 'sb-segmented';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', label);
  const buttons = options.map((option) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    button.dataset.value = String(option.value);
    button.addEventListener('click', () => {
      if (option.value === value) return;
      value = option.value; paint(); onChange(value);
    });
    return button;
  });
  function paint() { buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(options[i].value === value))); }
  element.append(...buttons);
  paint();
  return {
    element,
    get value() { return value; },
    set value(next) { value = next; paint(); },
    // The pressed option's button, else the first: where focus belongs when returning to this choice.
    focus() { (buttons.find((button) => button.getAttribute('aria-pressed') === 'true') || buttons[0]).focus(); },
  };
}
