// node test-support/zoom-shot-example.mjs <episode-work-directory>
// Produces editable recipes, sources, two playable shots and eight inspected frames.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { renderZoomShot } from '../src/runtime/worker/zoom-shot.mjs';

const fps = 8;
const base = { width: 640, height: 360, fps, frame: [0.1, 0.1, 0.8, 0.8],
  startCrop: [0.1, 0.1, 0.8, 0.8], endCrop: [0.5, 0.3, 0.4, 0.4],
  moveStart: 0.25, land: 1.25, hold: 0.75, easing: 'smoothstep' };

function dashboard(n) {
  const counter = String(n).padStart(2, '0');
  const markers = ['#f5bd62', '#62ddbb', '#ec83a3', '#85b4ff'];
  const bars = [48, 68, 45, 90, 78, 104, 94, 66, 85, 98, 92, 114];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="#e9ede8"/>
    <g font-family="DejaVu Sans,sans-serif">
    <rect width="640" height="34" fill="#172f38"/>
    <text x="20" y="23" fill="#fff" font-size="14">STATION 04   /   RIVER OBSERVATORY</text>
    <text x="507" y="23" fill="#fff" font-size="14">FRAME  ${counter}</text>
    <rect x="616" y="8" width="16" height="16" fill="${markers[n % 4]}"/>
    <text x="82" y="86" font-size="29" fill="#172f38">Catchment levels</text>
    <rect x="82" y="108" width="222" height="144" fill="#fff"/>
    ${bars.map((v, i) => `<rect x="${90 + i * 17}" y="${241 - v}" width="10" height="${v}" fill="#258d7d"/>`).join('')}
    <rect x="320" y="108" width="256" height="144" fill="#172f38"/>
    <rect x="326" y="114" width="244" height="132" fill="none" stroke="#63968f" stroke-width="2"/>
    <text x="342" y="149" font-size="25" fill="#fff">Legend</text>
    <circle cx="349" cy="176" r="7" fill="#62ddbb"/>
    <text x="365" y="182" font-size="17" fill="#fff">River level</text>
    <circle cx="349" cy="202" r="7" fill="#f5bd62"/>
    <text x="365" y="208" font-size="17" fill="#fff">Rainfall</text>
    <text x="342" y="235" font-size="14" fill="#c5dbd4">Sample   ${counter}</text>
    <rect x="526" y="215" width="22" height="18" fill="${markers[n % 4]}"/>
    <text x="82" y="281" font-size="15" fill="#355852">Gauge readings   /   North bank</text>
    <path d="M0 327H640" stroke="#8caaa0"/>
    <text x="20" y="349" font-size="13" fill="#355852">FIELD SURVEY   /   Station series</text></g></svg>`;
}

export async function makeZoomFixtures(dir) {
  await mkdir(dir, { recursive: true });
  const tmp = await mkdtemp(join(dir, 'counters-'));
  try {
    for (let n = 0; n < 24; n++) {
      const svg = dashboard(n);
      const png = new Resvg(svg).render().asPng();
      if (!n) {
        await writeFile(join(dir, 'dashboard.svg'), svg);
        await writeFile(join(dir, 'dashboard.png'), png);
      }
      await writeFile(join(tmp, `${String(n).padStart(2, '0')}.png`), png);
    }
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(tmp, '%02d.png'),
      '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:v', 'libx264rgb', '-threads', '2', '-crf', '0',
      '-c:a', 'aac', join(dir, 'dashboard.mp4')]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  const recipes = { still: { ...base, source: 'dashboard.png' },
    moving: { ...base, source: 'dashboard.mp4', sourceRange: [0.5, 2.5] } };
  for (const [name, recipe] of Object.entries(recipes)) {
    await writeFile(join(dir, `${name}.json`), JSON.stringify(recipe, null, 2) + '\n');
  }
  return recipes;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv[2]) throw new Error('Pass a directory for the editable example files');
  const dir = resolve(process.argv[2]);
  const recipes = await makeZoomFixtures(dir);
  for (const [name, recipe] of Object.entries(recipes)) {
    const shot = join(dir, `${name}.mp4`);
    await renderZoomShot({ ...recipe, source: join(dir, recipe.source) }, shot);
    for (const [label, t] of Object.entries({ opening: 0, intermediate: 0.5, landed: 1.25, held: 1.875 })) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', shot, '-frames:v', '1',
        join(dir, `${name}-${label}.png`)]);
    }
  }
}
