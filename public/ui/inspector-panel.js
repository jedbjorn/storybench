// Inspector panel: a titled side panel whose content follows the current selection. show(null)
// returns it to its empty state. Content is a node, a string, an array of either, or a function
// returning one (called on every show, so each render gets fresh nodes).
let nextId = 0;
const nodes = (value) => typeof value === 'function' ? nodes(value()) : [value].flat().filter((item) => item != null);

export function createInspectorPanel({ emptyTitle = 'Nothing selected', empty = 'Select an element to change it.', doc = document } = {}) {
  const element = doc.createElement('aside');
  const heading = doc.createElement('h2'), body = doc.createElement('div');
  element.className = 'sb-inspector';
  heading.id = `sb-inspector-${++nextId}`; heading.tabIndex = -1;
  body.className = 'sb-inspector-body';
  element.setAttribute('aria-labelledby', heading.id);
  element.append(heading, body);
  function show(selection) {
    element.classList.toggle('sb-inspector-empty', !selection);
    heading.textContent = selection ? selection.title : emptyTitle;
    body.replaceChildren(...nodes(selection ? selection.content : empty));
  }
  show(null);
  return {
    element,
    show,
    // Moves keyboard focus into the panel: its first control, else its title.
    focus() {
      const control = body.querySelector('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
      (control || heading).focus();
    },
  };
}
