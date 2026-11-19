// Slide editor (spec #46, Slide Editor): a modal around the Feature #25 canvas. The header holds
// previous and next, "Slide NN of N" and the title, the save state, Layout, the Markup and Send to chat
// slots (task #130) and close. Left: the canvas with Play slide and the step bar. Right: the Elements
// panel (the canvas inspector, then the fields of the slots the slide's type has; task #127 turns these
// into element cards). Escape steps back one layer per press: an open menu, then the selection, then
// the editor. ✕ closes at any time.
import { icons } from './icons.js';
import { slideFieldsHTML, bindSlideFields, layoutOptions, slideNumber } from './deck-workspace.js';

export function createSlideEditor(dialog, { canvas, getEpisode, getItems, getSections, saveState, onDirty, onSave, onClose = () => {} }) {
  const doc = dialog.ownerDocument, $ = (selector) => dialog.querySelector(selector);
  const root = $('[data-editor-root]'), elements = $('[data-editor-elements]'), scroller = $('[data-editor-scroll]');
  const count = $('[data-editor-count]'), title = $('[data-editor-title]'), saved = $('[data-editor-saved]'), layout = $('[data-editor-layout]');
  const previous = $('[data-editor-nav="-1"]'), next = $('[data-editor-nav="1"]');
  previous.innerHTML = icons.left; next.innerHTML = icons.right; $('[data-editor-close]').innerHTML = icons.close;
  let slideId = null, fieldsHTML = '', layoutHTML = '';
  const slides = () => getEpisode()?.cards || [];
  const position = () => slides().findIndex((slide) => slide.id === slideId);

  // The header's save state is the app's own.
  const mirror = () => { saved.textContent = saveState.textContent; };
  new MutationObserver(mirror).observe(saveState, { childList: true, characterData: true, subtree: true });

  bindSlideFields(root, { getSlides: slides, onDirty, onSave, render });
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-editor-close]')) return close();
    const step = Number(event.target.closest('[data-editor-nav]')?.dataset.editorNav);
    if (step) open(slides()[position() + step]?.id);
  });
  // Escape is handled before the canvas's selection surface sees it, so one press is one layer.
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !dialog.open) return;
    // An open list menu closes first; from its own trigger it closes itself.
    if (dialog.querySelector('.sb-select-menu')) {
      if (event.target.closest('.sb-select')) return;
      event.preventDefault(); event.stopPropagation();
      doc.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return;
    }
    event.preventDefault(); event.stopPropagation();
    if (canvas.selected) return canvas.deselect();
    close();
  }, true);
  dialog.addEventListener('close', () => { slideId = null; fieldsHTML = ''; canvas.hide(); onClose(); });

  // Re-renders keep the focused field, its caret and the panel's scroll.
  function replaceFields(html) {
    const active = elements.contains(doc.activeElement) ? doc.activeElement : null;
    const part = active?.closest('[data-part]'), key = active?.dataset.slideField;
    const caret = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const top = scroller.scrollTop;
    elements.innerHTML = fieldsHTML = html;
    scroller.scrollTop = top;
    if (!key) return;
    const field = [...elements.querySelectorAll(`[data-slide-field="${CSS.escape(key)}"]`)].find((node) => {
      const row = node.closest('[data-part]');
      return part ? row?.dataset.part === part.dataset.part && row.dataset.partIndex === part.dataset.partIndex : !row;
    });
    field?.focus({ preventScroll: true });
    if (field && caret) try { field.setSelectionRange(...caret); } catch { /* Not a text field. */ }
  }
  function render() {
    if (!dialog.open) return;
    const episode = getEpisode(), index = position();
    if (!episode || index < 0) return close();
    const slide = slides()[index];
    root.dataset.slideIndex = index;
    count.textContent = `Slide ${slideNumber(index)} of ${slides().length}`;
    title.textContent = slide.title;
    previous.disabled = index === 0;
    next.disabled = index === slides().length - 1;
    const options = layoutOptions(slide.layout);
    if (options !== layoutHTML) layout.innerHTML = layoutHTML = options;
    const html = slideFieldsHTML(slide, index, getItems(), getSections());
    if (html !== fieldsHTML) replaceFields(html);
    mirror();
    canvas.show(episode);
    canvas.open(slide.id);
  }
  function open(id) {
    if (!id || !slides().some((slide) => slide.id === id)) return;
    if (id !== slideId) { fieldsHTML = ''; scroller.scrollTop = 0; }
    slideId = id;
    if (!dialog.open) dialog.showModal();
    render();
  }
  // A field being typed in commits (its change saves) before the editor closes.
  function close() {
    if (!dialog.open) return;
    if (dialog.contains(doc.activeElement)) doc.activeElement.blur();
    dialog.close();
  }
  return {
    open,
    close,
    render,
    get isOpen() { return dialog.open; },
    get slideId() { return slideId; },
  };
}
