// Duration field: a whole number of milliseconds between `min` and `max`. Empty means the default
// (value null). A value is committed on change, Enter or leaving the field; an entry outside the bounds is refused
// with a message and leaves the committed value unchanged.
let nextId = 0;
const amount = (ms) => ms.toLocaleString('en-US');

export function createDurationField({ label, min = 0, max, value = null, defaultLabel = 'Default', step = 100, onChange = () => {}, doc = document }) {
  const id = `sb-duration-${++nextId}`;
  const element = doc.createElement('div');
  element.className = 'sb-duration';
  element.innerHTML = `<label for="${id}"></label><span class="sb-duration-entry"><input id="${id}" type="number" inputmode="numeric" aria-describedby="${id}-unit ${id}-error"><span id="${id}-unit" class="sb-duration-unit">ms</span></span><p id="${id}-error" class="sb-duration-error" role="alert"></p>`;
  const input = element.querySelector('input'), error = element.querySelector('.sb-duration-error');
  element.querySelector('label').textContent = label;
  Object.assign(input, { min, max, step, placeholder: defaultLabel });
  const show = (message) => {
    error.textContent = message;
    if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  };
  function commit() {
    const raw = input.value.trim();
    const next = raw === '' && !input.validity.badInput ? null : Number(raw);
    if (next !== null && (raw === '' || !Number.isInteger(next) || next < min || next > max))
      return show(`Enter whole milliseconds from ${amount(min)} to ${amount(max)}, or leave it empty for the default.`);
    show('');
    if (next === value) return;
    value = next; onChange(value);
  }
  // Enter commits without a native change event, so leaving the field must commit too.
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } });
  input.value = value ?? '';
  return {
    element,
    input,
    get value() { return value; },
    set value(next) { value = next; input.value = next ?? ''; show(''); },
  };
}
