// Slide editor (spec #46, Slide Editor): a modal around the Feature #25 canvas. The header holds
// previous and next, "Slide NN of N" and the title, the save state, Layout, Markup and Send to chat
// (see redline below) and close. Left: the canvas with Play slide and the step bar. Right: the Elements
// panel (the fields of the slots the slide's type has, then the canvas inspector; task #127 turns these
// into element cards). Escape steps back one layer per press: an open menu, then the selection, then
// the editor. ✕ closes at any time.
import { icons } from './icons.js';
import { slideFieldsHTML, bindSlideFields, layoutOptions, slideNumber } from './deck-workspace.js';
import { withChannel } from './preview-links.js';

// The note's picked assets: the slide's picks in today's fields (decision #123), each with its iteration.
function pickedAssets(slide, items) {
  const ids = [slide.vector?.itemId, slide.media?.itemId, ...(slide.subnav ?? []).map((view) => view.itemId)].filter(Boolean);
  return ids.map((itemId) => {
    const item = items.find((value) => value.id === itemId);
    const group = item ? items.filter((value) => value.iterationGroup === item.iterationGroup).length : 1;
    return { itemId, label: item?.label ?? itemId, iteration: item?.iteration ?? 1, of: group };
  });
}

export function createSlideEditor(dialog, { canvas, channel = () => null, getEpisode, getItems, getSections, saveState, onDirty, onSave, onClose = () => {} }) {
  const doc = dialog.ownerDocument, $ = (selector) => dialog.querySelector(selector);
  const root = $('[data-editor-root]'), elements = $('[data-editor-elements]'), scroller = $('[data-editor-scroll]');
  const count = $('[data-editor-count]'), title = $('[data-editor-title]'), saved = $('[data-editor-saved]'), layout = $('[data-editor-layout]');
  const previous = $('[data-editor-nav="-1"]'), next = $('[data-editor-nav="1"]');
  previous.innerHTML = icons.left; next.innerHTML = icons.right; $('[data-editor-close]').innerHTML = icons.close;
  const message = $('[data-editor-message]'), redlineButtons = [...dialog.querySelectorAll('[data-editor-redline]')];
  let slideId = null, fieldsHTML = '', layoutHTML = '', redlining = null;
  const slides = () => getEpisode()?.cards || [];
  const position = () => slides().findIndex((slide) => slide.id === slideId);

  // The header's save state is the app's own.
  const mirror = () => { saved.textContent = saveState.textContent; };
  new MutationObserver(mirror).observe(saveState, { childList: true, characterData: true, subtree: true });

  bindSlideFields(root, { getSlides: slides, onDirty, onSave, render });
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-editor-close]')) return close();
    const kind = event.target.closest('[data-editor-redline]')?.dataset.editorRedline;
    if (kind) return redline(kind);
    const step = Number(event.target.closest('[data-editor-nav]')?.dataset.editorNav);
    if (step) open(slides()[position() + step]?.id);
  });
  // Escape is handled before the canvas's selection surface sees it, so one press is one layer.
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !dialog.open) return;
    // The redline popup exits only by its ✕ or a successful Send (decision #85); its own list menu still closes.
    if (redlining) {
      if (!event.target.closest('.sb-select')) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
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
  // Selecting on the canvas brings its controls into view.
  dialog.addEventListener('sb-selectionchange', (event) => { if (event.detail.key) $('[data-editor-inspector]').scrollIntoView({ block: 'nearest' }); });
  dialog.addEventListener('close', () => { slideId = null; fieldsHTML = ''; message.textContent = ''; canvas.hide(); onClose(); });

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
    // An open redline is never dropped: a slide removed meanwhile closes the editor once the popup closes.
    if (!episode || index < 0) return redlining ? undefined : close();
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
  // Markup and Send to chat (spec #46 'Redlines'): the canvas as shown, the saved revision at the shown step,
  // captured by the server without a deck build, in the Feature #18 popup and send path (decision #85).
  // Send to chat is the same popup, sendable without marks. The note is written from the saved slide.
  async function redline(kind) {
    const episode = getEpisode(), shown = canvas.shown;
    if (redlining || !episode) return;
    if (!shown) { message.textContent = 'Wait for the slide to show, then try again.'; return; }
    redlining = kind; message.textContent = '';
    for (const button of redlineButtons) button.disabled = true;
    const pinnedPath = `/episodes/${encodeURIComponent(episode.id)}/deck-canvas/${shown.revision}/${encodeURIComponent(shown.slideId)}`;
    const done = () => { redlining = null; for (const button of redlineButtons) button.disabled = false; render(); };
    try {
      const response = await fetch(withChannel(`/api/episodes/${encodeURIComponent(episode.id)}/slides`, channel()));
      const deck = response.ok ? await response.json() : null;
      const index = deck?.slides.findIndex((slide) => slide.id === shown.slideId) ?? -1;
      if (!deck || index < 0) throw Object.assign(new Error('This slide is no longer saved.'), { name: 'MarkupRefused' });
      if (deck.revision !== shown.revision) throw Object.assign(new Error('The slide changed since it was shown. Try again once the canvas shows the saved slide.'), { name: 'MarkupRefused' });
      const slide = deck.slides[index];
      const metadata = { source: 'canvas', episodeId: episode.id, channelId: channel(), revision: shown.revision,
        slide: { number: slideNumber(index), id: slide.id, title: slide.title, steps: (slide.stages ?? []).map((stage) => stage.title ?? '') },
        picks: pickedAssets(slide, getItems() ?? []) };
      const module = await import('./redline.js');
      const { canvas: image } = await module.captureBase(metadata, null, pinnedPath, shown);
      module.openRedline({ metadata, pinnedPath, canvas: image, context: module.contextLine(metadata, null, shown), host: dialog,
        title: kind === 'send' ? 'Send to chat' : 'Markup', requireMarks: kind !== 'send',
        onSent: ({ name }) => { message.textContent = `Sent to “${name}”.`; },
        onClosed: () => { done(); dialog.querySelector(`[data-editor-redline="${kind}"]`)?.focus(); } });
    } catch (error) {
      done();
      message.textContent = error?.name === 'MarkupRefused' ? error.message : 'This slide cannot be marked up.';
    }
  }
  function open(id) {
    if (!id || !slides().some((slide) => slide.id === id)) return;
    if (id !== slideId) { fieldsHTML = ''; scroller.scrollTop = 0; message.textContent = ''; }
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
