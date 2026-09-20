import { spawn } from 'node:child_process';
import { access, link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

export const GRAPHIC_LIMITS = Object.freeze({
  maxWidth: 1920, maxHeight: 1080, maxDuration: 30, maxLayers: 100, maxFps: 30,
  maxImageBytes: 20 * 1024 * 1024, maxTotalImageBytes: 64 * 1024 * 1024,
  maxImagePixels: 16 * 1024 * 1024, maxTotalImagePixels: 32 * 1024 * 1024,
});
export const DEFAULT_GRAPHIC_FONT = Object.freeze({ family: 'DejaVu Sans', path: '/usr/share/fonts/TTF/DejaVuSans.ttf' });
const KINDS = ['text', 'rectangle', 'ellipse', 'line', 'path', 'image'];
const MOTION = ['x', 'y', 'scale', 'rotation', 'opacity'];
const COMMON = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, z: 0 };

export class GraphicValidationError extends Error {
  constructor(code, message, path = '') { super(message); this.name = 'GraphicValidationError'; this.code = code; this.path = path; this.statusCode = 400; }
}
const fail = (code, message, path = '') => { throw new GraphicValidationError(code, message, path); };
function object(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', `${path || 'recipe'} must be an object`, path); return value; }
function keys(value, allowed, path) { for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('UNKNOWN_FIELD', `Unknown field ${key}`, path ? `${path}.${key}` : key); }
function number(value, path, { min = -Infinity, max = Infinity, integer = false, positive = false } = {}) {
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max || (positive && value <= 0)) fail('INVALID_NUMBER', `${path} is outside its numeric bounds`, path);
  return value;
}
function string(value, fallback, path, { max = 4096, choices } = {}) {
  const result = value ?? fallback;
  if (typeof result !== 'string' || result.length > max || (choices && !choices.includes(result))) fail('INVALID_STRING', `${path} is invalid`, path);
  return result;
}
function color(value, fallback, path) {
  const result = string(value, fallback, path, { max: 32 });
  if (!/^(?:#[0-9a-f]{3,8}|[a-z]{1,30})$/i.test(result)) fail('INVALID_COLOR', `${path} must be a named or hexadecimal color`, path);
  return result;
}
function paint(layer, input, path, defaultFill) {
  layer.fill = color(input.fill, defaultFill, `${path}.fill`);
  layer.stroke = color(input.stroke, 'none', `${path}.stroke`);
  layer.strokeWidth = number(input.strokeWidth ?? 0, `${path}.strokeWidth`, { min: 0, max: 1000 });
}
function keyframes(value, duration, path) {
  if (value == null) return undefined;
  object(value, path); keys(value, MOTION, path);
  const result = {};
  for (const [property, entries] of Object.entries(value)) {
    const p = `${path}.${property}`;
    if (!Array.isArray(entries) || !entries.length || entries.length > 900) fail('INVALID_KEYFRAMES', `${p} must contain 1 to 900 entries`, p);
    let prior = -1;
    result[property] = entries.map((entry, i) => {
      const ep = `${p}[${i}]`; object(entry, ep); keys(entry, ['time', 'value', 'easing'], ep);
      const time = number(entry.time, `${ep}.time`, { min: 0, max: duration });
      if (time <= prior) fail('KEYFRAME_ORDER', `${p} times must increase`, `${ep}.time`); prior = time;
      const bounds = property === 'scale' ? { positive: true, max: 16 } : property === 'opacity' ? { min: 0, max: 1 } : property === 'rotation' ? { min: -36000, max: 36000 } : { min: -7680, max: 7680 };
      const val = number(entry.value, `${ep}.value`, bounds);
      if (property === 'scale' && val <= 0) fail('INVALID_SCALE', 'scale must be positive', `${ep}.value`);
      if (property === 'opacity' && (val < 0 || val > 1)) fail('INVALID_OPACITY', 'opacity must be between 0 and 1', `${ep}.value`);
      return { time, value: val, easing: string(entry.easing, 'linear', `${ep}.easing`, { choices: ['linear', 'hold'] }) };
    });
  }
  return result;
}
function layer(input, index, duration) {
  const p = `layers[${index}]`; object(input, p);
  const kind = string(input.kind, undefined, `${p}.kind`, { choices: KINDS });
  const fields = { text: ['text', 'fontSize', 'fontFamily', 'fontWeight', 'fill', 'textAnchor'], rectangle: ['width', 'height', 'rx', 'fill', 'stroke', 'strokeWidth'], ellipse: ['rx', 'ry', 'fill', 'stroke', 'strokeWidth'], line: ['x2', 'y2', 'stroke', 'strokeWidth'], path: ['d', 'fill', 'stroke', 'strokeWidth'], image: ['itemId', 'width', 'height'] }[kind];
  keys(input, ['kind', ...Object.keys(COMMON), 'keyframes', ...fields], p);
  const out = { kind };
  for (const [field, fallback] of Object.entries(COMMON)) out[field] = number(input[field] ?? fallback, `${p}.${field}`, field === 'scale' ? { positive: true, max: 16 } : field === 'opacity' ? { min: 0, max: 1 } : field === 'rotation' ? { min: -36000, max: 36000 } : field === 'z' ? { min: -100000, max: 100000, integer: true } : { min: -7680, max: 7680 });
  if (out.scale <= 0) fail('INVALID_SCALE', 'scale must be positive', `${p}.scale`);
  if (out.opacity < 0 || out.opacity > 1) fail('INVALID_OPACITY', 'opacity must be between 0 and 1', `${p}.opacity`);
  if (duration == null && input.keyframes != null) fail('STILL_KEYFRAMES', 'Still recipes cannot have keyframes', `${p}.keyframes`);
  if (duration != null) out.keyframes = keyframes(input.keyframes, duration, `${p}.keyframes`);
  if (kind === 'text') {
    const requestedFont = string(input.fontFamily, DEFAULT_GRAPHIC_FONT.family, `${p}.fontFamily`, { max: 200 });
    if (!/^[\p{L}\p{N} ._-]+$/u.test(requestedFont)) fail('INVALID_FONT_FAMILY', 'fontFamily contains unsupported characters', `${p}.fontFamily`);
    Object.assign(out, { text: string(input.text, undefined, `${p}.text`, { max: 10000 }), fontSize: number(input.fontSize ?? 48, `${p}.fontSize`, { positive: true, max: 1000 }), fontFamily: DEFAULT_GRAPHIC_FONT.family, fontWeight: number(input.fontWeight ?? 400, `${p}.fontWeight`, { min: 100, max: 900, integer: true }), fill: color(input.fill, '#fff', `${p}.fill`), textAnchor: string(input.textAnchor, 'start', `${p}.textAnchor`, { choices: ['start', 'middle', 'end'] }) });
  }
  if (kind === 'rectangle') { out.width = number(input.width, `${p}.width`, { positive: true, max: 7680 }); out.height = number(input.height, `${p}.height`, { positive: true, max: 4320 }); out.rx = number(input.rx ?? 0, `${p}.rx`, { min: 0, max: 7680 }); paint(out, input, p, '#fff'); }
  if (kind === 'ellipse') { out.rx = number(input.rx, `${p}.rx`, { positive: true, max: 3840 }); out.ry = number(input.ry, `${p}.ry`, { positive: true, max: 2160 }); paint(out, input, p, '#fff'); }
  if (kind === 'line') Object.assign(out, { x2: number(input.x2, `${p}.x2`, { min: -7680, max: 7680 }), y2: number(input.y2, `${p}.y2`, { min: -7680, max: 7680 }), stroke: color(input.stroke, '#fff', `${p}.stroke`), strokeWidth: number(input.strokeWidth ?? 1, `${p}.strokeWidth`, { min: 0, max: 1000 }) });
  if (kind === 'path') { out.d = string(input.d, undefined, `${p}.d`, { max: 100000 }); if (!/^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\-\s]+$/.test(out.d) || [...out.d.matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)].some(match => Math.abs(Number(match[0])) > 7680)) fail('INVALID_PATH', 'Path data contains unsupported characters or coordinates', `${p}.d`); paint(out, input, p, 'none'); }
  if (kind === 'image') { out.itemId = string(input.itemId, undefined, `${p}.itemId`, { max: 500 }); if (input.width != null) out.width = number(input.width, `${p}.width`, { positive: true, max: 7680 }); if (input.height != null) out.height = number(input.height, `${p}.height`, { positive: true, max: 4320 }); }
  return out;
}

export function validateGraphicRecipe(recipe, { resolveImage } = {}) {
  object(recipe, ''); keys(recipe, ['kind', 'width', 'height', 'background', 'layers', 'duration', 'fps'], '');
  const kind = string(recipe.kind, undefined, 'kind', { choices: ['still', 'motion'] });
  const width = number(recipe.width, 'width', { positive: true, max: GRAPHIC_LIMITS.maxWidth, integer: true });
  const height = number(recipe.height, 'height', { positive: true, max: GRAPHIC_LIMITS.maxHeight, integer: true });
  if (!Array.isArray(recipe.layers) || recipe.layers.length > GRAPHIC_LIMITS.maxLayers) fail('LAYER_LIMIT', 'layers must contain at most 100 entries', 'layers');
  let duration; let fps;
  if (kind === 'motion') { duration = number(recipe.duration, 'duration', { positive: true, max: 30 }); fps = number(recipe.fps ?? 30, 'fps', { min: 1, max: 30, integer: true }); if (!Number.isInteger(duration * fps)) fail('FRAME_ALIGNMENT', 'duration must resolve to a whole frame at fps', 'duration'); if (width % 2 || height % 2) fail('MOTION_DIMENSIONS', 'Motion width and height must be even for H.264 output', width % 2 ? 'width' : 'height'); }
  else if (recipe.duration != null || recipe.fps != null) fail('STILL_TIMING', 'Still recipes cannot contain duration or fps', recipe.duration != null ? 'duration' : 'fps');
  const layers = recipe.layers.map((item, index) => layer(item, index, duration));
  if (layers.some(item => item.kind === 'image') && resolveImage != null && typeof resolveImage !== 'function') fail('INVALID_RESOLVER', 'resolveImage must be a function', 'resolveImage');
  return { kind, width, height, background: color(recipe.background, 'transparent', 'background'), layers, ...(kind === 'motion' ? { duration, fps } : {}) };
}

const within = (root, candidate) => { const rel = relative(root, candidate); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
function at(item, property, time) {
  const points = item.keyframes?.[property]; if (!points?.length || time < points[0].time) return item[property];
  const last = points.at(-1); if (time >= last.time) return last.value;
  const index = points.findIndex(point => point.time > time); const before = points[index - 1]; const after = points[index];
  return before.easing === 'hold' ? before.value : before.value + (after.value - before.value) * ((time - before.time) / (after.time - before.time));
}
function jpegSize(data) {
  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) return null;
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda || offset + 2 > data.length) return null;
    const length = data.readUInt16BE(offset); if (length < 2 || offset + length > data.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) return null;
      return { width: data.readUInt16BE(offset + 5), height: data.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}
function webpSize(data) {
  const kind = data.subarray(12, 16).toString();
  if (kind === 'VP8X' && data.length >= 30) return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
  if (kind === 'VP8 ' && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L' && data.length >= 25 && data[20] === 0x2f) { const bits = data.readUInt32LE(21); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }; }
  return null;
}
function sniff(data, path = '') {
  let mime; let dimensions;
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { mime = 'image/png'; dimensions = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }; }
  else if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) { mime = 'image/jpeg'; dimensions = jpegSize(data); }
  else if (data.length >= 16 && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') { mime = 'image/webp'; dimensions = webpSize(data); }
  if (!mime || !dimensions || !dimensions.width || !dimensions.height) fail('INVALID_IMAGE', 'Resolved image must be a valid PNG, JPEG, or WebP header', path);
  return { mime, ...dimensions };
}
async function loadImages(plan, workspace, resolveImage) {
  const root = await realpath(resolve(workspace)).catch(() => fail('INVALID_WORKSPACE', 'workspace must exist', 'workspace')); const images = new Map(); let totalBytes = 0; let totalPixels = 0;
  for (const [index, item] of plan.layers.entries()) {
    if (item.kind !== 'image' || images.has(item.itemId)) continue;
    const p = `layers[${index}].itemId`; if (typeof resolveImage !== 'function') fail('IMAGE_RESOLVER_REQUIRED', 'Image layers require resolveImage', p);
    const source = await resolveImage(item.itemId); let data; let declaredMime;
    if (typeof source === 'string') { if (!isAbsolute(source)) fail('INVALID_IMAGE', 'Resolved image path must be absolute', p); const canonical = await realpath(source).catch(() => null); if (!canonical || !within(root, canonical)) fail('IMAGE_PATH_ESCAPE', 'Resolved image must be inside workspace', p); const info = await lstat(canonical); if (!info.isFile() || info.size > GRAPHIC_LIMITS.maxImageBytes) fail('INVALID_IMAGE', 'Resolved image file is invalid or too large', p); data = await readFile(canonical); }
    else { object(source, `resolveImage(${item.itemId})`); data = Buffer.isBuffer(source.data) ? source.data : source.data instanceof Uint8Array ? Buffer.from(source.data) : null; if (!data || data.length > GRAPHIC_LIMITS.maxImageBytes) fail('INVALID_IMAGE', 'Resolved image data is invalid or too large', p); declaredMime = source.mimeType; }
    const { mime, width, height } = sniff(data, p); if (declaredMime != null && declaredMime !== mime) fail('INVALID_IMAGE', 'Resolved image MIME type does not match its bytes', p);
    const pixels = width * height; totalBytes += data.length; totalPixels += pixels;
    if (pixels > GRAPHIC_LIMITS.maxImagePixels) fail('IMAGE_PIXEL_LIMIT', 'Resolved image dimensions exceed the per-image pixel limit', p);
    if (totalBytes > GRAPHIC_LIMITS.maxTotalImageBytes) fail('IMAGE_TOTAL_LIMIT', 'Resolved images exceed the aggregate byte limit', p);
    if (totalPixels > GRAPHIC_LIMITS.maxTotalImagePixels) fail('IMAGE_TOTAL_LIMIT', 'Resolved images exceed the aggregate pixel limit', p);
    images.set(item.itemId, `data:${mime};base64,${data.toString('base64')}`);
  }
  return { root, images };
}
function svg(plan, images, time) {
  const body = plan.layers.map((item, sourceIndex) => ({ item, sourceIndex })).sort((a, b) => a.item.z - b.item.z || a.sourceIndex - b.sourceIndex).map(({ item }) => {
    const attrs = `transform="translate(${at(item, 'x', time)} ${at(item, 'y', time)}) rotate(${at(item, 'rotation', time)}) scale(${at(item, 'scale', time)})" opacity="${at(item, 'opacity', time)}"`;
    if (item.kind === 'text') return `<text ${attrs} font-family="${xml(item.fontFamily)}" font-size="${item.fontSize}" font-weight="${item.fontWeight}" fill="${xml(item.fill)}" text-anchor="${item.textAnchor}">${xml(item.text)}</text>`;
    if (item.kind === 'rectangle') return `<rect ${attrs} width="${item.width}" height="${item.height}" rx="${item.rx}" fill="${xml(item.fill)}" stroke="${xml(item.stroke)}" stroke-width="${item.strokeWidth}"/>`;
    if (item.kind === 'ellipse') return `<ellipse ${attrs} rx="${item.rx}" ry="${item.ry}" fill="${xml(item.fill)}" stroke="${xml(item.stroke)}" stroke-width="${item.strokeWidth}"/>`;
    if (item.kind === 'line') return `<line ${attrs} x2="${item.x2}" y2="${item.y2}" stroke="${xml(item.stroke)}" stroke-width="${item.strokeWidth}"/>`;
    if (item.kind === 'path') return `<path ${attrs} d="${xml(item.d)}" fill="${xml(item.fill)}" stroke="${xml(item.stroke)}" stroke-width="${item.strokeWidth}"/>`;
    return `<image ${attrs}${item.width ? ` width="${item.width}"` : ''}${item.height ? ` height="${item.height}"` : ''} href="${images.get(item.itemId)}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.width}" height="${plan.height}" viewBox="0 0 ${plan.width} ${plan.height}"><rect width="100%" height="100%" fill="${xml(plan.background)}"/>${body}</svg>`;
}
function raster(plan, images, time) { try { return new Resvg(svg(plan, images, time), { fitTo: { mode: 'original' }, font: { fontFiles: [DEFAULT_GRAPHIC_FONT.path], loadSystemFonts: false, defaultFontFamily: DEFAULT_GRAPHIC_FONT.family } }).render().asPng(); } catch (cause) { const error = new GraphicValidationError('RASTERIZE_FAILED', `Graphic rasterization failed: ${cause.message}`); error.cause = cause; throw error; } }
const aborted = () => Object.assign(new Error('Graphic rendering cancelled'), { name: 'AbortError', code: 'ABORT_ERR' });
async function motion(plan, images, target, signal, progress) {
  const child = spawn('ffmpeg', ['-v', 'error', '-threads', '2', '-f', 'image2pipe', '-framerate', String(plan.fps), '-vcodec', 'png', '-i', 'pipe:0', '-an', '-r', String(plan.fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', target], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
  const exit = new Promise((ok, bad) => { child.on('error', bad); child.on('close', code => code === 0 ? ok() : bad(new Error(`ffmpeg exited with code ${code}: ${stderr.trim() || 'no diagnostics'}`))); });
  const abort = () => child.kill('SIGTERM'); signal?.addEventListener('abort', abort, { once: true });
  const frames = Math.round(plan.duration * plan.fps);
  try { for (let frame = 0; frame < frames; frame++) { if (signal?.aborted) throw aborted(); const png = raster(plan, images, frame / plan.fps); if (!child.stdin.write(png)) await new Promise((ok, bad) => { child.stdin.once('drain', ok); child.stdin.once('error', bad); }); progress?.((frame + 1) / frames); } child.stdin.end(); await exit; if (signal?.aborted) throw aborted(); return frames; }
  catch (error) { child.stdin.destroy(); child.kill('SIGTERM'); await exit.catch(() => {}); if (signal?.aborted && error.name !== 'AbortError') throw aborted(); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}

export async function renderGraphic({ workspace, recipe, outputPath, resolveImage, signal, onProgress } = {}) {
  const plan = validateGraphicRecipe(recipe, { resolveImage }); if (signal?.aborted) throw aborted();
  await access(DEFAULT_GRAPHIC_FONT.path).catch(() => fail('FONT_UNAVAILABLE', `Fallback font is unavailable: ${DEFAULT_GRAPHIC_FONT.path}`, 'font'));
  const { root, images } = await loadImages(plan, workspace, resolveImage); const output = resolve(outputPath); const parent = dirname(output);
  if (!within(root, output)) fail('OUTPUT_PATH_ESCAPE', 'outputPath must be inside workspace', 'outputPath'); await mkdir(parent, { recursive: true });
  if (!within(root, await realpath(parent))) fail('OUTPUT_PATH_ESCAPE', 'outputPath parent escapes workspace', 'outputPath');
  if (await lstat(output).catch(() => null)) fail('OUTPUT_EXISTS', 'outputPath already exists', 'outputPath');
  const temporary = resolve(parent, `.graphic-${randomUUID()}${plan.kind === 'still' ? '.png' : '.mp4'}`);
  try { let frames = 1; if (plan.kind === 'still') { await writeFile(temporary, raster(plan, images, 0), { flag: 'wx', mode: 0o600 }); onProgress?.(1); } else frames = await motion(plan, images, temporary, signal, onProgress); if (signal?.aborted) throw aborted(); await link(temporary, output); await unlink(temporary); return { path: output, kind: plan.kind === 'still' ? 'image' : 'video', width: plan.width, height: plan.height, ...(plan.kind === 'motion' ? { duration: plan.duration } : {}), metadata: { frames, ...(plan.kind === 'motion' ? { fps: plan.fps } : {}), fontFallback: DEFAULT_GRAPHIC_FONT.family } }; }
  finally { await unlink(temporary).catch(() => {}); }
}
