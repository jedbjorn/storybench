import Painterro from './painterro.js';
import { withChannel, workspaceSelection } from './preview-links.js';

// The redline popup: one still of the pinned asset, Painterro marks, a prompt, and Send to chat.
// Loaded only when Markup is first pressed, so ordinary previews never fetch Painterro. Its stylesheet
// loads with it, on the Preview page and in the slide editor alike.
if (!document.querySelector('link[data-redline-style]')) await new Promise(resolve => {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/redline.css', onload: resolve, onerror: resolve });
  link.dataset.redlineStyle = '';
  document.head.append(link);
});
const LIMIT = 20 * 1024 * 1024;
const MIN_EDGE = 800, MAX_EDGE = 2560, SVG_EDGE = 1920;
const NO_PROMPT = 'See the marks on the attached image.', NO_MARKS = 'See the attached image.';
const BUSY = 'A turn is active for this production. Let it finish or press Stop in the chat, then send.';
const HIDDEN_TOOLS = ['select', 'crop', 'pixelize', 'eraser', 'rotate', 'resize', 'settings', 'zoomin', 'zoomout', 'bucket', 'filters', 'clear', 'save', 'open', 'close'];
const working = state => ['queued', 'running', 'interrupting'].includes(state);

export class MarkupRefused extends Error { name = 'MarkupRefused'; }

export function timecode(seconds) {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
}

const quoted = list => list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
const version = ({ iteration, of }) => `v${iteration}${of > 1 ? ` of ${of}` : ''}`;
// A deck asset (spec #46 'Redlines'): its iteration and the slides it is a candidate for, the starred one marked.
function assetSuffix({ number, of, slides }) {
  const where = slides.map(slide => `slide ${slide.number} “${slide.title}”${slide.starred ? ' (starred)' : ''}`);
  return `, iteration ${version({ iteration: number, of })}, ${where.length ? `a candidate for ${quoted(where)}` : 'not a candidate for any slide'}`;
}
// The slide editor's canvas (spec #46 'Redlines'): slide number and title, the shown step, the saved revision
// and the picked assets with their iterations. `shown.stage` is the canvas's step: null is All, 0 is Start.
function slideLine({ revision, slide, picks }, { stage }) {
  const count = slide.steps.length, named = index => slide.steps[index] ? ` “${slide.steps[index]}”` : '';
  const step = count < 2 ? '' : stage === null ? ', all steps shown' : stage === 0 ? `, at Start${named(0)}` : `, step ${stage} of ${count - 1}${named(stage)}`;
  const picked = picks.length ? `showing ${quoted(picks.map(pick => `“${pick.label}” ${version(pick)} (${pick.itemId})`))}` : 'no asset picked';
  return `Redline on slide ${slide.number} “${slide.title}” (${slide.id}) in the slide editor, saved revision ${revision}${step}, ${picked}.`;
}

// `shown` is the deck state the Preview page trusted (slideId, index, stage and gallery of the pinned build) and the frame size,
// or the slide editor canvas's shown step.
export function contextLine(metadata, seconds, shown) {
  const at = Number.isFinite(seconds) ? ` at ${timecode(seconds)}` : '';
  const newer = metadata.latestUrl ? ' A newer version exists.' : '';
  if (metadata.source === 'canvas') return slideLine(metadata, shown);
  if (metadata.source === 'library') return `Redline on library item “${metadata.label}” (${metadata.itemId})${metadata.iteration ? assetSuffix(metadata.iteration) : ''}${at}.${newer}`;
  if (metadata.kind === 'deck') {
    const slide = metadata.deck.slides[shown.index];
    const reveal = shown.stage === null ? '' : `, reveal ${shown.stage + 1} of ${slide.stages.length} “${slide.stages[shown.stage]}”`;
    const view = shown.gallery === null ? '' : `, view “${slide.views[shown.gallery]}”`;
    return `Redline on deck build ${metadata.jobId} (revision ${metadata.deck.revision}), slide ${shown.index + 1} “${slide.title}” (${slide.id})${reveal}${view}.${newer}`;
  }
  const output = metadata.outputClass === 'final' ? 'Final' : ['draft', 'legacy_draft'].includes(metadata.outputClass) ? 'Draft' : 'Graphic';
  return `Redline on ${output} output ${metadata.jobId}${at}.${newer}`;
}

function fitted(width, height, minimum = MIN_EDGE) {
  const long = Math.max(width, height), goal = Math.min(MAX_EDGE, Math.max(minimum, long));
  return { width: Math.max(1, Math.round(width * goal / long)), height: Math.max(1, Math.round(height * goal / long)) };
}

function draw(source, { width, height }) {
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { width, height });
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  context.getImageData(0, 0, 1, 1); // Throws SecurityError when the browser refuses to read these pixels.
  return canvas;
}

async function fetchBlob(url) {
  const response = await fetch(url);
  if (!response.ok) throw new MarkupRefused('This asset cannot be marked up.');
  return response.blob();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new MarkupRefused('This asset cannot be marked up.'));
    image.src = url;
  });
}

async function bitmapBase(blob) {
  const bitmap = await createImageBitmap(blob).catch(() => { throw new MarkupRefused('This asset cannot be marked up.'); });
  try { return draw(bitmap, fitted(bitmap.width, bitmap.height)); } finally { bitmap.close(); }
}

async function videoFrame(video) {
  video.pause();
  if (video.seeking) await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));
  if (video.readyState < 2) await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));
  if (!video.videoWidth) throw new MarkupRefused('This video has no picture to mark up.');
  return { canvas: draw(video, fitted(video.videoWidth, video.videoHeight)), seconds: video.currentTime };
}

// A deck frame has an opaque origin, so the server renders the shown state at the frame's size.
async function deckCapture(metadata, { slideId, stage, gallery, width, height }) {
  const response = await fetch(withChannel(`/api/preview/deck/${encodeURIComponent(metadata.jobId)}/capture`, metadata.channelId), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slideId, stage, gallery, width, height }) });
  if (!response.ok) throw new MarkupRefused((await response.json().catch(() => ({}))).error || 'This slide cannot be marked up.');
  return response.blob();
}

// The slide editor's canvas: the server renders the saved slide at the shown step and scroll, without a build.
async function canvasCapture(metadata, pinnedPath, { stage, scroll }) {
  const response = await fetch(withChannel(`/api${pinnedPath}/capture`, metadata.channelId), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage, scroll }) });
  if (!response.ok) throw new MarkupRefused((await response.json().catch(() => ({}))).error || 'This slide cannot be marked up.');
  return response.blob();
}

// One still of what the creator sees. A GIF decodes to its first frame through createImageBitmap.
export async function captureBase(metadata, media, pinnedPath, shown) {
  try {
    if (metadata.source === 'canvas') return { canvas: await bitmapBase(await canvasCapture(metadata, pinnedPath, shown)) };
    if (metadata.kind === 'deck') return { canvas: await bitmapBase(await deckCapture(metadata, shown)) };
    if (metadata.kind === 'video') return await videoFrame(media);
    const blob = await fetchBlob(metadata.mediaUrl);
    if (metadata.contentType !== 'image/svg+xml') return { canvas: await bitmapBase(blob) };
    const url = URL.createObjectURL(new Blob([blob], { type: 'image/svg+xml' }));
    try {
      const image = await loadImage(url);
      return { canvas: draw(image, fitted(image.naturalWidth || metadata.width || 300, image.naturalHeight || metadata.height || 150, SVG_EDGE)) };
    } catch {
      // The browser refused the SVG canvas: use the server-rendered PNG instead.
      return { canvas: await bitmapBase(await fetchBlob(withChannel(`/api${pinnedPath}/raster`, metadata.channelId))) };
    } finally { URL.revokeObjectURL(url); }
  } catch (error) {
    if (error instanceof MarkupRefused) throw error;
    throw new MarkupRefused('This asset cannot be marked up.');
  }
}

async function shrink(blob) {
  // Keep the sent PNG within the chat image limit by scaling it down rather than refusing it.
  while (blob.size > LIMIT) {
    const bitmap = await createImageBitmap(blob);
    const canvas = draw(bitmap, { width: Math.max(1, Math.round(bitmap.width * 0.8)), height: Math.max(1, Math.round(bitmap.height * 0.8)) });
    bitmap.close();
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  return blob;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status });
  return data;
}

// Opens the popup over the Preview page, or within `host` (the slide editor's modal dialog). `context` is
// app-written; `position` labels the stored redline. Without `requireMarks` (Send to chat) the frame can be
// sent as it is, with or without marks and a prompt.
export function openRedline({ metadata, pinnedPath, canvas, context, position = '', title = 'Markup', requireMarks = true, host = document.body, onSent = () => {}, onClosed = () => {} }) {
  const doc = document;
  const episodeUrl = path => withChannel(`/api/episodes/${encodeURIComponent(metadata.episodeId)}${path}`, metadata.channelId);
  const backdrop = doc.createElement('div');
  backdrop.className = 'redline-backdrop';
  backdrop.innerHTML = `<section class="redline" role="dialog" aria-modal="true" aria-labelledby="redline-title" data-marks="0">
    <header><h2 id="redline-title"></h2><button type="button" class="redline-close" data-redline-close aria-label="Close markup" title="Close markup">×</button></header>
    <div class="redline-canvas" id="redline-canvas"></div>
    <div class="redline-send">
      <p class="redline-context" data-redline-context></p>
      <label class="redline-prompt">Prompt<textarea data-redline-prompt rows="2" placeholder="What should change?"></textarea></label>
      <div class="redline-actions">
        <label class="redline-target">Send to<select data-redline-target></select></label>
        <p class="redline-status" role="status" data-redline-status></p>
        <button type="button" class="redline-submit" data-redline-send disabled>Send to chat</button>
      </div>
    </div>
  </section>`;
  const $ = selector => backdrop.querySelector(selector);
  const dialog = $('.redline'), prompt = $('[data-redline-prompt]'), target = $('[data-redline-target]'), status = $('[data-redline-status]'), send = $('[data-redline-send]');
  $('[data-redline-context]').textContent = context;
  $('#redline-title').textContent = title;
  const inerted = [...host.children].filter(element => !element.inert);
  for (const element of inerted) element.inert = true;
  host.append(backdrop);

  const long = Math.max(canvas.width, canvas.height);
  // `current` is the target the selector shows: the default once the list first loads, then only the creator's
  // choice. When it disappears it becomes null and Send waits for an explicit choice; it is never replaced silently.
  let ptro, baseline = null, marks = 0, conversations = null, current = null, defaulted = true, busy = false, sending = false, error = '', closed = false;
  const unsent = () => marks > 0 || prompt.value.trim() !== '';
  const paint = () => {
    dialog.dataset.marks = String(marks);
    status.textContent = error || (busy ? BUSY : sending ? 'Sending…' : '');
    send.disabled = busy || sending || !current || (requireMarks && !unsent());
    send.title = busy ? BUSY : '';
  };
  const countMarks = () => {
    const count = ptro?.worklog?.current?.prevCount ?? 0;
    if (baseline === null) baseline = count;
    marks = Math.max(0, count - baseline);
    paint();
  };
  // Painterro remembers colour and sizes across sessions; each redline starts on red, sized from its base image.
  try { localStorage.removeItem('painterro-data'); } catch { /* storage unavailable */ }
  ptro = Painterro({
    id: 'redline-canvas', defaultTool: 'arrow', hiddenTools: HIDDEN_TOOLS, toolbarPosition: 'top',
    activeColor: '#ff0000', activeColorAlpha: 1, activeFillColorAlpha: 0,
    defaultLineWidth: Math.max(3, Math.round(long / 320)), defaultArrowLength: Math.max(15, Math.round(long / 80)),
    defaultFontSize: Math.max(24, Math.round(long / 40)), defaultTextStrokeAndShadow: true,
    hideByEsc: false, saveByEnter: false, fixMobilePageReloader: false, disableWheelZoom: false,
    colorScheme: { main: '#ffffff', control: '#f7f6f2', controlContent: '#173d39', activeControl: '#173d39', activeControlContent: '#ffffff',
      inputBorderColor: '#dfe3df', inputBackground: '#ffffff', inputText: '#202525', backgroundColor: '#e8ece9', dragOverBarColor: '#e8f0ed' },
    onImageLoaded: () => { baseline = null; countMarks(); },
    onChange: countMarks, onUndo: countMarks, onRedo: countMarks,
  });
  ptro.show(canvas.toDataURL('image/png'));

  // Pasting or dropping an image never replaces or extends the base image.
  const blockPaste = event => { if ([...(event.clipboardData?.items || [])].some(item => item.kind === 'file')) { event.preventDefault(); event.stopPropagation(); } };
  const blockDrop = event => { event.preventDefault(); event.stopPropagation(); };
  const leave = event => { if (!unsent()) return; event.preventDefault(); event.returnValue = ''; };
  window.addEventListener('paste', blockPaste, true);
  window.addEventListener('dragover', blockDrop, true);
  window.addEventListener('drop', blockDrop, true);
  window.addEventListener('beforeunload', leave);

  const lose = () => { current = null; error = 'The chosen conversation no longer exists. Choose where to send.'; };
  const refresh = async () => {
    let list;
    try { list = await request(episodeUrl('/chats')); } catch { return; }
    if (closed) return;
    // Defaults: the selection of a workspace tab that has this production open, else the most recent conversation.
    // A defaulted "New conversation" gives way to the conversations once some exist.
    const gone = current && (current === 'new' ? list.length > 0 : !list.some(item => item.id === current));
    if (!conversations || (gone && current === 'new' && defaulted))
      current = list.length ? list.find(item => item.id === workspaceSelection(metadata.episodeId))?.id ?? list[0].id : 'new';
    else if (gone) lose();
    conversations = list;
    busy = list.some(item => working(item.state));
    const options = [...(current ? [] : [['', 'Choose a conversation']]), ...(list.length ? list.map(item => [item.id, item.name]) : [['new', 'New conversation']])];
    if (target.dataset.options !== JSON.stringify(options)) {
      target.replaceChildren(...options.map(([value, name]) => Object.assign(doc.createElement('option'), { value, textContent: name, disabled: !value })));
      target.dataset.options = JSON.stringify(options);
    }
    target.value = current ?? '';
    paint();
  };
  const timer = setInterval(refresh, 1500);
  refresh();

  const close = () => {
    closed = true;
    clearInterval(timer);
    window.removeEventListener('paste', blockPaste, true);
    window.removeEventListener('dragover', blockDrop, true);
    window.removeEventListener('drop', blockDrop, true);
    window.removeEventListener('beforeunload', leave);
    ptro.hide();
    backdrop.remove();
    for (const element of inerted) element.inert = false;
    onClosed();
  };
  target.onchange = () => { current = target.value || null; defaulted = false; error = ''; paint(); };
  // The prompt is two lines tall, grows with its text to four, then scrolls.
  prompt.oninput = () => {
    prompt.style.height = 'auto';
    prompt.style.height = `${prompt.scrollHeight + prompt.offsetHeight - prompt.clientHeight}px`;
    prompt.style.overflowY = prompt.scrollHeight > prompt.clientHeight ? 'auto' : 'hidden';
    paint();
  };
  $('[data-redline-close]').onclick = () => {
    if (sending) return;
    if (unsent() && !confirm('Discard this markup and prompt?')) return;
    close();
  };
  send.onclick = async () => {
    if (send.disabled) return;
    sending = true; error = ''; paint();
    try {
      let conversationId = current, name = conversations.find(item => item.id === conversationId)?.name;
      if (conversationId === 'new') ({ id: conversationId, name } = await request(episodeUrl('/chats'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Conversation 1' }) }));
      const png = await shrink(ptro.imageSaver.asBlob('image/png'));
      // Uploading identical bytes again returns the same redline record, so a retry never duplicates it.
      const item = await request(withChannel(`/api${pinnedPath}/redline`, metadata.channelId), { method: 'POST',
        headers: { 'content-type': 'image/png', ...(position ? { 'x-redline-position': position } : {}) }, body: png });
      const text = `${context}\n\n${prompt.value.trim() || (marks ? NO_PROMPT : NO_MARKS)}`;
      await request(episodeUrl(`/chats/${encodeURIComponent(conversationId)}/messages`), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, attachmentIds: [item.id] }) });
      sending = false;
      close();
      onSent({ conversationId, name });
    } catch (cause) {
      sending = false;
      error = cause.status === 409 && /active/i.test(cause.message) ? BUSY : cause.message || 'Send failed. Your markup is still here; try again.';
      if (cause.status === 404 && /conversation/i.test(cause.message)) lose();
      paint();
      refresh();
    }
  };
  prompt.focus();
  return { element: backdrop, close };
}
