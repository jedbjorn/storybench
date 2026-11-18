// Position picker: where a block sits around a visual — top, bottom, left or right. One Tab stop;
// the arrow keys move straight to the side they point at. `value` may be null (not set).
import { createChoiceGrid } from './choice-grid.js';

const sides = { ArrowUp: 'top', ArrowDown: 'bottom', ArrowLeft: 'left', ArrowRight: 'right' };

export function createPositionPicker({ label = 'Position', value = null, onChange = () => {}, doc = document } = {}) {
  const grid = createChoiceGrid({
    className: 'sb-position', label, value, onChange, doc,
    cells: [
      { value: 'top', label: 'Above visual', row: 0, col: 1 },
      { value: 'left', label: 'Left of visual', row: 1, col: 0 },
      { value: 'right', label: 'Right of visual', row: 1, col: 2 },
      { value: 'bottom', label: 'Below visual', row: 2, col: 1 },
    ],
    next: (key) => sides[key],
  });
  const visual = doc.createElement('span');
  visual.className = 'sb-position-visual';
  visual.setAttribute('aria-hidden', 'true');
  visual.textContent = 'Visual';
  grid.element.append(visual);
  return grid;
}
