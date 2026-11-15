import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSvg, svgFontFiles, svgError } from './svg.js';

// A native renderer is isolated from the app event loop and killed on timeout/cancel.
export function renderSvg(bytes, { maxWidth = 1024, timeoutMs = 30000, signal } = {}) {
  if (!Number.isInteger(maxWidth) || maxWidth < 1 || maxWidth > 2048) throw svgError('inspection width must be 1–2048');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), String(maxWidth)], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, stderr = '', timedOut = false;
    const abort = () => child.kill('SIGKILL');
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { size += chunk.length; if (size <= 8 * 1024 * 1024) chunks.push(chunk); else abort(); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.stdin.on('error', () => {}); // Child exit reports the failure.
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(signal.reason);
      if (timedOut) return reject(svgError('inspection renderer timed out'));
      if (code !== 0 || !size || size > 8 * 1024 * 1024) return reject(svgError(`inspection renderer failed: ${stderr.trim() || 'invalid output'}`));
      resolve(Buffer.concat(chunks));
    });
    child.stdin.end(bytes);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
    const parsed = parseSvg(Buffer.concat(chunks));
    const { Resvg } = await import('@resvg/resvg-js');
    const width = Math.max(1, Math.floor(Math.min(Number(process.argv[2]), parsed.width, 2048 * parsed.width / parsed.height)));
    const png = new Resvg(parsed.svg, { fitTo: { mode: 'width', value: width },
      font: { fontFiles: svgFontFiles(parsed.fonts), loadSystemFonts: false, defaultFontFamily: 'Manrope' } }).render().asPng();
    process.stdout.write(png);
  } catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
}
