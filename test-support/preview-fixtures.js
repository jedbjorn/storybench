import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// These match the pre-fix decision #81 capture (run 150). A one-frame GIF fails
// the existing importer thumbnail seek on Halo; SC-GIF-THUMB-SEEK tracks it.
export const previewPNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAABAAAAAQBPJcTWAAAANklEQVR4nO3QwQkAMAwDsRS6/8aFjnCv/KQBbLjzZtdd3h8HSaIkUZIoSZQkShIliZJESaIpHwOEAXtEFT2UAAAAAElFTkSuQmCC', 'base64');
export function previewFixtures(folder) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'image.png'), previewPNG);
  writeFileSync(path.join(folder, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>');
  for (const extension of ['webp', 'jpg']) execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(folder, 'image.png'), '-frames:v', '1', '-y', path.join(folder, `image.${extension}`)]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=1', '-y', path.join(folder, 'image.gif')]);
  for (const extension of ['mov', 'mp4']) execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(folder, `video.${extension}`)]);
  return [
    ['image.png', ''], ['image.jpg', 'image/jpeg'], ['image.webp', 'image/webp'], ['image.webp', ''],
    ['image.gif', 'image/gif'], ['image.gif', ''], ['video.mov', 'video/quicktime'], ['video.mov', ''],
    ['image.svg', 'image/svg+xml'], ['image.svg', ''], ['video.mp4', 'video/mp4'],
  ];
}
