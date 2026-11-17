// The preview popup: the /preview page framed in its embedded mode, or a file pane for items it cannot
// show, beside an optional side column (the library edit form). It closes only by its X or Cancel —
// Escape and backdrop clicks are ignored, so a stray key never drops unsaved edits or open markup.
export class PreviewModal {
  constructor(dialog) {
    this.dialog = dialog;
    this.title = dialog.querySelector('[data-preview-title]');
    this.frame = dialog.querySelector('[data-preview-frame]');
    this.file = dialog.querySelector('[data-preview-file]');
    this.aside = dialog.querySelector('[data-preview-aside]');
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') event.preventDefault(); });
    dialog.addEventListener('click', (event) => { if (event.target.closest('[data-preview-close]')) this.close(); });
    dialog.addEventListener('close', () => { this.load(''); this.file.replaceChildren(); });
    // The framed page names what it shows, including after its own "View latest" navigation.
    window.addEventListener('message', ({ source, origin, data }) => {
      if (source === this.frame.contentWindow && origin === location.origin && data?.type === 'storybench-preview-label')
        this.title.textContent = data.label;
    });
  }
  // `url` frames a /preview page; otherwise `file` (trusted HTML) fills the viewer. `aside` shows the side column.
  open({ url = '', file = '', title = 'Preview', aside = false }) {
    this.title.textContent = title;
    this.load(url);
    this.file.hidden = !!url;
    this.file.innerHTML = url ? '' : file;
    this.aside.hidden = !aside;
    if (!this.dialog.open) this.dialog.showModal();
  }
  close() { if (this.dialog.open) this.dialog.close(); }
  // Each page gets a fresh frame: unloading the last one stops its media, and a first load adds no entry to
  // the browser's Back history, as re-pointing one frame's src would.
  load(url) {
    const frame = this.frame.cloneNode(false);
    frame.removeAttribute('src');
    if (url) frame.src = url;
    frame.hidden = !url;
    this.frame.replaceWith(frame);
    this.frame = frame;
  }
}
