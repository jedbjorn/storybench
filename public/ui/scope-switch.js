// Scope switch: whether a change applies to this slide or all slides, with a marker and a reset
// action shown while the slide overrides the deck default. Built on the segmented choice.
import { createSegmentedChoice } from './segmented-choice.js';

const words = { label: 'Apply changes to', slide: 'This slide', deck: 'All slides', overridden: 'Changed on this slide', reset: 'Use deck default' };

export function createScopeSwitch({ value = 'slide', overridden = false, labels = {}, onChange = () => {}, onReset = () => {}, doc = document } = {}) {
  const text = { ...words, ...labels };
  const choice = createSegmentedChoice({
    label: text.label, value, onChange, doc,
    options: [{ value: 'slide', label: text.slide }, { value: 'deck', label: text.deck }],
  });
  const element = doc.createElement('div');
  const marker = doc.createElement('span'), reset = doc.createElement('button');
  element.className = 'sb-scope';
  marker.className = 'sb-scope-marker'; marker.textContent = text.overridden;
  reset.type = 'button'; reset.className = 'sb-scope-reset'; reset.textContent = text.reset;
  reset.addEventListener('click', () => onReset());
  element.append(choice.element, marker, reset);
  function mark(next) {
    overridden = Boolean(next);
    // A reset hides its own button; keep keyboard focus inside the switch.
    if (!overridden && reset === doc.activeElement) choice.focus();
    marker.hidden = reset.hidden = !overridden;
  }
  mark(overridden);
  return {
    element,
    get value() { return choice.value; },
    set value(next) { choice.value = next; },
    get overridden() { return overridden; },
    set overridden(next) { mark(next); },
  };
}
