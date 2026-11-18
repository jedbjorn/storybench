// Alignment grid: three by three cells that set `align` (horizontal) and `valign` (vertical) in one
// choice. Value is { align, valign }, each start, center or end, or null when not set. One Tab stop;
// the arrow keys move one cell and stop at the edges.
import { createChoiceGrid } from './choice-grid.js';

const steps = ['start', 'center', 'end'];
const rows = ['Top', 'Middle', 'Bottom'], cols = ['left', 'centre', 'right'];
const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const keyOf = (value) => value?.align && value?.valign ? `${value.align} ${value.valign}` : null;
const valueOf = (key) => { const [align, valign] = key.split(' '); return { align, valign }; };

export function createAlignmentGrid({ label = 'Alignment', value = null, onChange = () => {}, doc = document } = {}) {
  const cells = [];
  steps.forEach((valign, row) => steps.forEach((align, col) => {
    const dot = doc.createElement('span');
    dot.className = 'sb-align-dot';
    cells.push({ value: `${align} ${valign}`, label: row === 1 && col === 1 ? 'Centred' : `${rows[row]} ${cols[col]}`, row, col, content: dot });
  }));
  const grid = createChoiceGrid({
    className: 'sb-align', label, cells, doc, value: keyOf(value),
    onChange: (key) => onChange(valueOf(key)),
    next(key, from) {
      if (!moves[key]) return undefined;
      const { align, valign } = valueOf(from);
      const row = steps.indexOf(valign) + moves[key][0], col = steps.indexOf(align) + moves[key][1];
      return steps[row] && steps[col] ? `${steps[col]} ${steps[row]}` : null;
    },
  });
  return {
    element: grid.element,
    get value() { return grid.value && valueOf(grid.value); },
    set value(next) { grid.value = keyOf(next); },
    focus: grid.focus,
  };
}
