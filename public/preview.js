import { formatBytes } from './job-status.js';

const $ = selector => document.querySelector(selector);
const metadataUrl = `/api${location.pathname}${location.search}`;
let current;
let events;

function unavailable(message = 'This item is no longer available.') {
  events?.close();
  $('#viewer').replaceChildren();
  $('#download').hidden = true;
  $('#actual-size').hidden = true;
  $('#markup').hidden = true;
  $('#newer').hidden = true;
  $('#label').textContent = 'Preview unavailable';
  $('#details').textContent = '';
  $('#message').textContent = message;
  document.title = 'Storybench Preview — Unavailable';
}

function newer(metadata) {
  current.latestUrl = metadata.latestUrl;
  $('#newer').hidden = !metadata.latestUrl;
  if (metadata.latestUrl) $('#latest').href = metadata.latestUrl;
}

function watchChanges() {
  events = new EventSource(`/api/episodes/${encodeURIComponent(current.episodeId)}/events?channel=${encodeURIComponent(current.channelId)}`);
  let refreshing = false, changed = false;
  events.onmessage = async () => {
    changed = true;
    if (refreshing) return;
    refreshing = true;
    try {
      do {
        changed = false;
        const response = await fetch(metadataUrl);
        if ([404, 410].includes(response.status)) return unavailable();
        if (response.ok) newer(await response.json());
      } while (changed);
    } catch {
      // Keep the pinned media on a transient disconnect; the next change/reconnect retries.
    } finally { refreshing = false; }
  };
  window.addEventListener('pagehide', () => events.close(), { once: true });
}

function details() {
  const { contentType, kind, bytes, width, height, duration } = current;
  $('#details').textContent = [kind === 'deck' ? 'Deck' : contentType, formatBytes(bytes),
    width && height ? `${width} × ${height}` : '', Number.isFinite(duration) ? `${duration.toFixed(1)} s` : ''].filter(Boolean).join(' · ');
}

async function open() {
  const response = await fetch(metadataUrl);
  if (!response.ok) return unavailable([404, 410].includes(response.status) ? undefined : 'Could not load this preview. Reload to try again.');
  current = await response.json();
  document.title = `Storybench Preview — ${current.label}`;
  $('#production').textContent = current.production;
  $('#label').textContent = current.label;
  $('#download').href = current.downloadUrl;
  $('#download').textContent = current.kind === 'deck' ? 'Download bundle (ZIP)' : 'Download';
  $('#download').hidden = false;
  const media = document.createElement(current.kind === 'deck' ? 'iframe' : current.kind === 'image' ? 'img' : 'video');
  if (current.kind === 'deck') {
    media.title = current.label;
    media.setAttribute('sandbox', 'allow-scripts');
  } else if (current.kind === 'image') {
    media.alt = current.label;
    $('#actual-size').hidden = false;
    media.onload = () => { current.width = media.naturalWidth; current.height = media.naturalHeight; details(); $('#markup').hidden = false; };
  } else {
    media.controls = true;
    media.onloadedmetadata = () => { current.width = media.videoWidth; current.height = media.videoHeight; current.duration = media.duration; details(); $('#markup').hidden = false; };
  }
  media.onerror = async () => {
    $('#markup').hidden = true;
    const response = await fetch(metadataUrl);
    if ([404, 410].includes(response.status)) unavailable();
    else $('#message').textContent = 'This browser cannot display this media. You can still download it.';
  };
  media.src = current.mediaUrl;
  $('#viewer').className = current.kind;
  $('#viewer').replaceChildren(media);
  details();
  newer(current);
  watchChanges();
}

$('#actual-size').onclick = () => {
  const actual = $('#viewer').classList.toggle('actual');
  $('#actual-size').setAttribute('aria-pressed', String(actual));
  $('#actual-size').textContent = actual ? 'Fit to window' : 'Actual size';
};
// Markup (image, SVG and video; decks join in a later lane). The popup module and Painterro load on first use.
$('#markup').onclick = async () => {
  const button = $('#markup'), media = $('#viewer > img, #viewer > video');
  if (button.disabled || !media || current.kind === 'deck') return;
  button.disabled = true;
  $('#message').textContent = '';
  try {
    const redline = await import('./redline.js');
    const { canvas, seconds } = await redline.captureBase(current, media, location.pathname);
    redline.openRedline({ metadata: current, pinnedPath: location.pathname, canvas,
      context: redline.contextLine(current, seconds),
      position: Number.isFinite(seconds) ? `at ${redline.timecode(seconds)}` : '',
      onSent: ({ name }) => { $('#message').textContent = `Redline sent to “${name}”.`; },
      onClosed: () => { button.disabled = false; button.focus(); } });
  } catch (error) {
    button.disabled = false;
    $('#message').textContent = error?.name === 'MarkupRefused' ? error.message : 'This asset cannot be marked up.';
  }
};
open().catch(() => unavailable('Could not load this preview. Reload to try again.'));
