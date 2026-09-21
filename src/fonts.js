// One small catalogue shared by standards, browser previews and production rendering.
import { existsSync } from 'node:fs';

const dejavu = (id, family, file) => ({ id, family, stems: ['/usr/share/fonts/truetype/dejavu/', '/usr/share/fonts/TTF/'], regular: `${file}.ttf`, bold: `${file}-Bold.ttf` });
const liberation = (id, family, file) => ({ id, family, stems: ['/usr/share/fonts/truetype/liberation2/', '/usr/share/fonts/truetype/liberation/', '/usr/share/fonts/liberation/'], regular: `${file}-Regular.ttf`, bold: `${file}-Bold.ttf` });
export const FONTS = Object.freeze([
  dejavu('dejavu-sans', 'DejaVu Sans', 'DejaVuSans'),
  dejavu('dejavu-serif', 'DejaVu Serif', 'DejaVuSerif'),
  dejavu('dejavu-mono', 'DejaVu Sans Mono', 'DejaVuSansMono'),
  liberation('liberation-sans', 'Liberation Sans', 'LiberationSans'),
  liberation('liberation-serif', 'Liberation Serif', 'LiberationSerif'),
  liberation('liberation-mono', 'Liberation Mono', 'LiberationMono'),
]);
export const fontForFamily = (family) => FONTS.find((font) => font.family === family);
export function fontPath(font, weight = 'regular') {
  if (!font || !['regular', 'bold'].includes(weight)) return null;
  return font.stems.map((stem) => stem + font[weight]).find(existsSync) ?? null;
}
export function fontCatalog() {
  return FONTS.map((font) => {
    const regular = fontPath(font), bold = fontPath(font, 'bold');
    return { id: font.id, family: font.family, available: Boolean(regular && bold), weights: [400, 700],
      files: { regular, bold }, urls: { regular: `/api/fonts/${font.id}/regular`, bold: `/api/fonts/${font.id}/bold` } };
  });
}
