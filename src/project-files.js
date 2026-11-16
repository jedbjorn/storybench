import path from 'node:path';

const types = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.html': 'text/html', '.htm': 'text/html', '.xhtml': 'application/xhtml+xml',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf', '.txt': 'text/plain',
};

export function projectContentType(asset = {}, file = '') {
  const stored = asset.metadata?.contentType?.split(';')[0].trim().toLowerCase();
  if (stored && stored !== 'application/octet-stream') return stored;
  const named = types[path.extname(asset.name || file).toLowerCase()];
  if (named) return named;
  const codec = asset.metadata?.streams?.find(stream => stream.codec_type === 'video')?.codec_name;
  const image = { png: 'image/png', mjpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[codec];
  if (image) return image;
  if (asset.metadata?.format?.format_name?.includes('webm')) return 'video/webm';
  return { image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg' }[asset.kind]
    || 'application/octet-stream';
}

export function downloadDisposition(download, label, originalName) {
  const extension = path.extname(originalName || '').replace(/[^.a-zA-Z0-9]/g, '');
  let name = String(label || path.basename(originalName || '') || 'download').toWellFormed()
    .replace(/[\x00-\x1f\x7f/\\"<>:|?*]/g, '_').trim().slice(0, 180) || 'download';
  if (extension && !name.toLowerCase().endsWith(extension.toLowerCase())) name += extension;
  const fallback = name.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
