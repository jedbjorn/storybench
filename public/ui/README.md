# UI primitives

Shared controls for Storybench screens (spec #44, "UI primitives, step one"). Each one is a plain ES
module with no app or deck state: give it labels and a value, get back an element and a callback.
Load `/styles.css` (the colour tokens) and `/ui/ui.css`; the primitives use only the `:root` tokens.

For a list choice use the existing select control (`/select-control.js`); for a colour use the
existing colour picker (`/color-picker.js`). Neither is duplicated here.

| Module | Use it for | Keyboard |
|---|---|---|
| `selection-surface.js` | Making `[data-select]` elements inside a container selectable | Tab reaches each element; Enter or Space selects; Escape deselects |
| `inspector-panel.js` | A titled side panel that shows the current selection's controls, or an empty state | Normal tab order; `focus()` moves into it |
| `segmented-choice.js` | Two to five mutually exclusive options in one row | Tab to an option; Enter or Space chooses |
| `position-picker.js` | Top, bottom, left or right of a visual | One Tab stop; arrow keys go to that side |
| `alignment-grid.js` | `align` and `valign` together in a three by three grid | One Tab stop; arrow keys move one cell |
| `duration-field.js` | Whole milliseconds within bounds; empty = default | Native number entry; Enter or Tab commits |
| `scope-switch.js` | This slide or All slides, with a changed marker and a reset | As segmented choice, plus the reset button |

Every control takes `doc` (default `document`) and an `onChange` callback, exposes `element` to place
in the page and a `value` you can read or set without firing `onChange`. A `null` value means unset:
nothing is pressed or checked and the duration field is empty. Choice controls carry an accessible
label but no visible caption; place one beside them.

```js
import { createSelectionSurface } from '/ui/selection-surface.js';
import { createInspectorPanel } from '/ui/inspector-panel.js';
import { createPositionPicker } from '/ui/position-picker.js';
import { createScopeSwitch } from '/ui/scope-switch.js';

// <div id="canvas"><section data-select="copy" data-select-label="Copy block">…</section></div>
const inspector = createInspectorPanel({ empty: () => slideWideControls() });
sidebar.append(inspector.element);
const surface = createSelectionSurface(canvas, {
  onChange(key) {
    if (!key) return inspector.show(null);
    const position = createPositionPicker({ value: effective(key).position, onChange: (side) => save(key, { position: side }) });
    inspector.show({ title: 'Copy block', content: [position.element] });
  },
});
// After re-rendering the canvas, keep the selection on the new nodes (or clear it if gone):
surface.refresh();
```

Behaviour worth knowing:

- **Selection surface.** A click on an element selects it; a click on empty surface deselects. While
  focus is inside the surface, Escape is consumed there (it never reaches a drawer or dialog Escape
  handler), even with nothing selected. Selection changes call `onChange(key, element)` and dispatch a
  bubbling `sb-selectionchange` event with `detail: { key, element }`. `select(key)` selects in code.
- **Inspector panel.** `show({ title, content })` or `show(null)` for the empty state. Content is a node,
  string, array, or a function returning one.
- **Duration field.** Commits on change, Enter or leaving the field. Out-of-range or fractional entries show a message and
  keep the last committed value; `onChange(null)` means "use the default".
- **Scope switch.** `value` is `'slide'` or `'deck'`. Set `overridden` to show the marker and the
  Use deck default action; `onReset` fires when it is chosen. Labels are replaceable through `labels`.

`choice-grid.js` is internal: the one-Tab-stop radio grid behind the position picker and alignment
grid.

Tests: `test/ui-primitives.test.js` (unit, jsdom) and `test/ui-primitives-browser.test.js` (Chromium
and Firefox on a blank page).

In use: the Slides canvas and its inspector (`/deck-canvas.js`) only; other screens move onto these in the later UI refactor.
