// One small catalogue shared by standards, browser previews and production rendering.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dejavu = (id, family, file) => ({ id, family, stems: ['/usr/share/fonts/truetype/dejavu/', '/usr/share/fonts/TTF/'], regular: `${file}.ttf`, bold: `${file}-Bold.ttf` });
const liberation = (id, family, file) => ({ id, family, stems: ['/usr/share/fonts/truetype/liberation2/', '/usr/share/fonts/truetype/liberation/', '/usr/share/fonts/liberation/'], regular: `${file}-Regular.ttf`, bold: `${file}-Bold.ttf` });
const bundled = (id, family, file) => ({ id, family, stems: [fileURLToPath(new URL(`./font-assets/${id}/`, import.meta.url))], regular: `${file}-Regular.ttf`, bold: `${file}-Bold.ttf` });
export const FONTS = Object.freeze([
  dejavu('dejavu-sans', 'DejaVu Sans', 'DejaVuSans'),
  dejavu('dejavu-serif', 'DejaVu Serif', 'DejaVuSerif'),
  dejavu('dejavu-mono', 'DejaVu Sans Mono', 'DejaVuSansMono'),
  liberation('liberation-sans', 'Liberation Sans', 'LiberationSans'),
  liberation('liberation-serif', 'Liberation Serif', 'LiberationSerif'),
  liberation('liberation-mono', 'Liberation Mono', 'LiberationMono'),
  bundled('lato', 'Lato', 'Lato'),
  bundled('poppins', 'Poppins', 'Poppins'),
  bundled('barlow', 'Barlow', 'Barlow'),
  bundled('barlowcondensed', 'Barlow Condensed', 'BarlowCondensed'),
  bundled('alegreyasans', 'Alegreya Sans', 'AlegreyaSans'),
  bundled('ptsans', 'PT Sans', 'PT_Sans-Web'),
  bundled('ptserif', 'PT Serif', 'PT_Serif-Web'),
  bundled('crimsontext', 'Crimson Text', 'CrimsonText'),
  bundled('cardo', 'Cardo', 'Cardo'),
  bundled('quattrocento', 'Quattrocento', 'Quattrocento'),
  bundled('arvo', 'Arvo', 'Arvo'),
  bundled('spacemono', 'Space Mono', 'SpaceMono'),
  bundled('kalam', 'Kalam', 'Kalam'),
  bundled('amaticsc', 'Amatic SC', 'AmaticSC'),
  bundled('cabinsketch', 'Cabin Sketch', 'CabinSketch'),
  bundled('alegreyasc', 'Alegreya SC', 'AlegreyaSC'),
  bundled('cormorantsc', 'Cormorant SC', 'CormorantSC'),
  bundled('philosopher', 'Philosopher', 'Philosopher'),
  bundled('quattrocentosans', 'Quattrocento Sans', 'QuattrocentoSans'),
  bundled('neuton', 'Neuton', 'Neuton'),
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
