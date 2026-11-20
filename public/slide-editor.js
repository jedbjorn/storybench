// Slide editor (spec #46, Slide Editor): a modal around the Feature #25 canvas. The header holds
// previous and next, "Slide NN of N" and the title, the save state, Layout, Markup and Send to chat
// (see redline below) and close. Left: the canvas with Play slide, the step bar and the selection toolbar.
// Right: the Elements panel: element cards for the slots the slide's type has (element-cards.js), then
// the slide-and-deck values. Selecting on the canvas highlights and opens the matching cards. Escape
// steps back one layer per press: an open menu, then the selection, then the editor. ✕ closes at any time.
import { icons } from './icons.js';
import { layoutOptions, slideNumber } from './deck-workspace.js';
import { elementCardsHTML, bindElementCards, cardsFor } from './element-cards.js';
import { drawingParts, validateDrawingParts } from './drawing-parts.js';
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

export function createSlideEditor(dialog, { canvas, channel = () => null, getEpisode, getItems, getSections, saveState, onDirty, onSave, onSaveDrawing, onClose = () => {}, onOpenAsset = () => {}, onAskForAnother = () => {} }) {
  const doc = dialog.ownerDocument, $ = (selector) => dialog.querySelector(selector);
  const root = $('[data-editor-root]'), elements = $('[data-editor-elements]'), scroller = $('[data-editor-scroll]');
  const count = $('[data-editor-count]'), title = $('[data-editor-title]'), saved = $('[data-editor-saved]'), layout = $('[data-editor-layout]');
  const previous = $('[data-editor-nav="-1"]'), next = $('[data-editor-nav="1"]');
  previous.innerHTML = icons.left; next.innerHTML = icons.right; $('[data-editor-close]').innerHTML = icons.close;
  const message = $('[data-editor-message]'), redlineButtons = [...dialog.querySelectorAll('[data-editor-redline]')];
  const assignment = $('[data-drawing-assignment]'), stepFields = $('[data-drawing-steps]');
  const confirmDrawing = $('[data-drawing-confirm]'), cancelDrawing = $('[data-drawing-cancel]'), drawingError = $('[data-drawing-error]');
  let drawingDraft = null, savingDrawing = false;
  let slideId = null, fieldsHTML = '', layoutHTML = '', redlining = null, notice = null, shownId = null;
  // Card state for the open slide: which cards are open, which match the canvas selection; and the
  // slides whose Gallery mode was chosen before a view was starred.
  const open_ = new Set(), active = new Set(), galleries = new Set();
  const slides = () => getEpisode()?.cards || [];
  const position = () => slides().findIndex((slide) => slide.id === slideId);

  // The header's save state is the app's own.
  const mirror = () => { saved.textContent = saveState.textContent; };
  new MutationObserver(mirror).observe(saveState, { childList: true, characterData: true, subtree: true });

  bindElementCards(root, { getSlides: slides, getItems, onSave, render,
    onDirty() { notice = null; onDirty(); },
    notify,
    onDrawingPick: pickDrawing,
    onReplay: (index) => canvas.replayStep(index),
    onPlayStep: (index) => canvas.playStep(index),
    onOpenAsset,
    // Ask for another fills the chat composer and does not send; the editor closes so the composer is in reach.
    onAskForAnother(text) { close(); onAskForAnother(text); },
    onToggle(key, isOpen) { if (isOpen) open_.add(key); else { open_.delete(key); active.delete(key); } },
    isGallery: (id) => galleries.has(id),
    onGalleryMode(id, on) { if (on) galleries.add(id); else galleries.delete(id); } });
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-editor-close]')) return close();
    const kind = event.target.closest('[data-editor-redline]')?.dataset.editorRedline;
    if (kind) return redline(kind);
    const step = Number(event.target.closest('[data-editor-nav]')?.dataset.editorNav);
    if (step) open(slides()[position() + step]?.id);
  });
  // Escape is handled before the canvas's selection surface sees it, so one press is one layer.
  dialog.addEventListener('cancel', (event) => { if (event.target === dialog) event.preventDefault(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !dialog.open || assignment.open) return;
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
    if (canvas.cancelResize?.() || canvas.closeMenu()) return;
    if (canvas.selected) return canvas.deselect();
    close();
  }, true);
  // Selecting on the canvas highlights the matching element cards, opens them and brings them into view.
  dialog.addEventListener('sb-selectionchange', (event) => {
    const slide = slides()[position()];
    active.clear(); notice = null;
    if (!slide) return;
    syncOpen();
    const keys = cardsFor(event.detail.key, slide);
    keys.forEach((key) => active.add(key));
    // Copy opens Title and Body; stage text opens its first step.
    (event.detail.key === 'stageText' ? keys.slice(0, 1) : keys).forEach((key) => open_.add(key));
    render(false);
    if (keys.length) elements.querySelector(`[data-card="${CSS.escape(keys[0])}"]`)?.scrollIntoView({ block: 'nearest' });
  });
  dialog.addEventListener('close', () => { slideId = null; shownId = null; fieldsHTML = ''; notice = null; message.textContent = ''; canvas.hide(); onClose(); });

  function notify(card, text) {
    syncOpen(); notice = { card, text }; open_.add(card); render(false);
  }

  function pickDrawing(slide, next, { asset }) {
    if (savingDrawing || assignment.open) return;
    const { id: episodeId, revision } = getEpisode();
    const base = { episodeId, revision };
    if (slide.vector || !slide.stages?.length) return commitDrawing(base, next);
    const parts = drawingParts(asset.metadata);
    if (parts.length < slide.stages.length)
      return notify('visual', 'This drawing has too few parts for these steps. Choose another drawing.');
    drawingDraft = { base, next, metadata: asset.metadata };
    stepFields.replaceChildren(...slide.stages.map((stage, index) => {
      const field = doc.createElement('label');
      const heading = doc.createElement('strong');
      heading.textContent = `Step ${index + 1}: ${stage.title}`;
      field.append(heading);
      if (stage.body) {
        const body = doc.createElement('span');
        body.className = 'drawing-step-copy';
        body.textContent = stage.body;
        field.append(body);
      }
      const select = doc.createElement('select');
      select.setAttribute('aria-label', `Part for step ${index + 1}: ${stage.title}`);
      for (const part of ['', ...parts]) {
        const option = doc.createElement('option');
        option.value = part;
        option.textContent = part || 'Choose part…';
        select.append(option);
      }
      field.append(select);
      return field;
    }));
    assignmentState();
    assignment.showModal();
  }

  function assignmentState() {
    if (!drawingDraft) return null;
    const selected = [...stepFields.querySelectorAll('select')].map(select => select.value);
    const stages = drawingDraft.next.stages.map((stage, index) => ({ ...stage, svgGroupIds: [selected[index]] }));
    let error = '';
    if (selected.every(Boolean)) {
      if (new Set(selected).size !== selected.length) error = 'Give each step a different part.';
      else try { validateDrawingParts(stages, drawingDraft.metadata); }
      catch (cause) { error = cause.message; }
    }
    drawingError.textContent = error;
    drawingError.hidden = !error;
    const ready = selected.every(Boolean) && !error;
    confirmDrawing.disabled = savingDrawing || !ready;
    return ready ? stages : null;
  }
  assignment.addEventListener('change', assignmentState);
  assignment.addEventListener('submit', event => {
    event.preventDefault();
    const stages = assignmentState();
    if (stages && !savingDrawing) commitDrawing(drawingDraft.base, { ...drawingDraft.next, stages });
  });
  assignment.addEventListener('cancel', event => { if (savingDrawing) event.preventDefault(); });
  assignment.addEventListener('close', () => { if (!assignment.open) drawingDraft = null; });
  cancelDrawing.onclick = () => assignment.close();

  async function commitDrawing(base, next) {
    savingDrawing = true;
    root.inert = true;
    stepFields.inert = true;
    confirmDrawing.disabled = cancelDrawing.disabled = true;
    let error;
    try { await onSaveDrawing(base, next); }
    catch (cause) { error = cause; }
    savingDrawing = false;
    root.inert = false;
    stepFields.inert = false;
    cancelDrawing.disabled = false;
    if (assignment.open) assignment.close();
    if (error) return notify('visual', error.status === 409 ? 'The deck changed. Reload it and try the drawing pick again.' : error.message);
    notice = null;
    render();
  }

  // Re-renders keep the focused field, its caret and the panel's scroll.
  function replaceFields(html) {
    const active = elements.contains(doc.activeElement) ? doc.activeElement : null;
    const part = active?.closest('[data-part]'), key = active?.dataset.slideField;
    const caret = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const top = scroller.scrollTop;
    elements.innerHTML = fieldsHTML = html;
    scroller.scrollTop = top;
    if (active?.dataset.slideAction === 'toggle-list-label') {
      elements.querySelector(`[data-part="stages"][data-part-index="${part.dataset.partIndex}"] [data-slide-action="toggle-list-label"]`)?.focus({ preventScroll: true });
    }
    if (!key) return;
    const field = [...elements.querySelectorAll(`[data-slide-field="${CSS.escape(key)}"]`)].find((node) => {
      const row = node.closest('[data-part]');
      return part ? row?.dataset.part === part.dataset.part && row.dataset.partIndex === part.dataset.partIndex : !row;
    });
    field?.focus({ preventScroll: true });
    if (field && caret) try { field.setSelectionRange(...caret); } catch { /* Not a text field. */ }
  }
  // The cards shown now are the truth for which are open: a toggle event arrives a task late, after an
  // edit may already have re-rendered them.
  function syncOpen() {
    if (shownId !== slideId) return;
    for (const node of elements.querySelectorAll('details[data-card]')) {
      if (node.open) open_.add(node.dataset.card); else open_.delete(node.dataset.card);
    }
  }
  // `sync` false: the caller has already read the shown cards and opened the ones it wants.
  function render(sync = true) {
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
    if (sync) syncOpen();
    const html = elementCardsHTML(slide, index, { items: getItems(), sections: getSections(), design: episode.design, open: open_, active, notice, gallery: galleries.has(slide.id) });
    if (html !== fieldsHTML) replaceFields(html);
    shownId = slide.id;
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
    if (id !== slideId) { fieldsHTML = ''; scroller.scrollTop = 0; message.textContent = ''; open_.clear(); active.clear(); notice = null; }
    slideId = id;
    if (!dialog.open) dialog.showModal();
    render();
  }
  // A field being typed in commits (its change saves) before the editor closes.
  function close() {
    if (!dialog.open || savingDrawing) return;
    if (assignment.open) assignment.close();
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
