// The same closed, parsed profile is used at ingestion, inspection and publication.
import { JSDOM } from 'jsdom';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fontForFamily, fontPath } from './fonts.js';
import { validateVectorStages } from './deck-data.js';

export const SVG_PROFILE = 'storybench-svg-1';
export const SVG_LIMITS = Object.freeze({ bytes: 512 * 1024, elements: 2000, depth: 32, dimension: 4096, expanded: 10000 });
const NS = 'http://www.w3.org/2000/svg';
const ID = /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const elements = {
  svg: 'viewBox width height preserveAspectRatio', g: '', defs: '', title: '', desc: '', style: '',
  path: 'd pathLength', rect: 'x y width height rx ry', circle: 'cx cy r', ellipse: 'cx cy rx ry',
  line: 'x1 y1 x2 y2', polyline: 'points', polygon: 'points', text: 'x y dx dy textLength lengthAdjust', tspan: 'x y dx dy textLength lengthAdjust',
  linearGradient: 'x1 y1 x2 y2 gradientUnits gradientTransform spreadMethod href',
  radialGradient: 'cx cy r fx fy fr gradientUnits gradientTransform spreadMethod href', stop: 'offset',
  clipPath: 'clipPathUnits', mask: 'x y width height maskUnits maskContentUnits',
  use: 'href x y', filter: 'x y width height filterUnits primitiveUnits',
  feGaussianBlur: 'in stdDeviation result', feOffset: 'in dx dy result',
  feFlood: 'result', feComposite: 'in in2 operator result', feMerge: 'result', feMergeNode: 'in',
};
const enums = {
  'fill-rule': ['nonzero', 'evenodd'], 'clip-rule': ['nonzero', 'evenodd'],
  'stroke-linecap': ['butt', 'round', 'square'], 'stroke-linejoin': ['miter', 'round', 'bevel'],
  'text-anchor': ['start', 'middle', 'end'], 'dominant-baseline': ['auto', 'middle', 'central', 'hanging', 'alphabetic', 'text-before-edge', 'text-after-edge'],
  'font-style': ['normal', 'italic', 'oblique'], 'font-weight': ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
  display: ['inline', 'block', 'none'], visibility: ['visible', 'hidden'], overflow: ['hidden', 'visible'],
  'vector-effect': ['none', 'non-scaling-stroke'], 'color-interpolation-filters': ['sRGB', 'linearRGB'],
  gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'], clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskUnits: ['userSpaceOnUse', 'objectBoundingBox'], maskContentUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  filterUnits: ['userSpaceOnUse', 'objectBoundingBox'], primitiveUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  spreadMethod: ['pad', 'reflect', 'repeat'], lengthAdjust: ['spacing', 'spacingAndGlyphs'], operator: ['over', 'in', 'out', 'atop', 'xor'],
};
const presentation = new Set(('fill stroke color stop-color flood-color opacity fill-opacity stroke-opacity stop-opacity flood-opacity stroke-width stroke-dasharray stroke-dashoffset stroke-miterlimit font-family font-size letter-spacing word-spacing clip-path mask filter ' + Object.keys(enums).filter(k => k.includes('-') || ['display', 'visibility', 'overflow'].includes(k)).join(' ')).split(' '));
const globalAttrs = new Set(['id', 'class', 'transform', 'style', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'data-stage', 'data-story-step', ...presentation]);
const containers = new Set(['svg', 'g', 'defs', 'clipPath', 'mask']);
function validChild(parent, child) {
  if (['title', 'desc'].includes(child)) return !['title', 'desc', 'style'].includes(parent);
  if (parent === 'filter') return ['feGaussianBlur', 'feOffset', 'feFlood', 'feComposite', 'feMerge'].includes(child);
  if (parent === 'feMerge') return child === 'feMergeNode';
  if (['linearGradient', 'radialGradient'].includes(parent)) return child === 'stop';
  if (['text', 'tspan'].includes(parent)) return child === 'tspan';
  return containers.has(parent) && !['stop', 'tspan'].includes(child) && !child.startsWith('fe');
}

export function svgError(message) { return Object.assign(new Error(`SVG (${SVG_PROFILE}): ${message}`), { code: 'INVALID_SVG', statusCode: 422 }); }
const fail = message => { throw svgError(message); };
function number(value, label, min = -100000, max = 100000) {
  if (!NUMBER.test(value) || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) fail(`${label} requires a finite number between ${min} and ${max}`);
  return Number(value);
}
function numbers(value, label, min, max) { return value.trim().split(/[\s,]+/).map(v => number(v, label, min, max)); }
function length(value, label, min = -100000, max = 100000) {
  return number(value.replace(/(?:px|%)$/, ''), label, min, max);
}
function pathData(value) {
  const tokens = value.match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/g) || [];
  if (value.replace(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[\s,]/g, '') || tokens.length > 20000) fail('invalid or excessive path data');
  const arities = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  if (!/^[mM]$/.test(tokens[0] || '')) fail('path must start with moveto');
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++].toUpperCase(), count = arities[command];
    if (count === undefined) fail('unsupported path command');
    let n = 0;
    while (i < tokens.length && !/^[a-z]$/i.test(tokens[i])) {
      const v = number(tokens[i++], 'path coordinate');
      if (command === 'A' && [3, 4].includes(n % 7) && v !== 0 && v !== 1) fail('arc flags must be 0 or 1');
      n++;
    }
    if (count ? !n || n % count : n) fail(`invalid ${command} path arguments`);
  }
}
function transform(value) {
  let rest = value.trim(), count = 0;
  while (rest) {
    const m = /^(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)\s*,?\s*/.exec(rest);
    if (!m || ++count > 32) fail('unsupported or excessive transform');
    const args = numbers(m[2], 'transform', -10000, 10000);
    if (!({ matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] })[m[1]].includes(args.length)) fail('invalid transform arguments');
    rest = rest.slice(m[0].length);
  }
}

// A candidate sniff routes XML into the parser; it never establishes validity.
export function looksLikeSvg(bytes) {
  const head = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '').trimStart()
    .replace(/^(?:(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->)\s*)*/, '');
  return /^<(?:[A-Za-z_][\w.-]*:)?svg(?:[\s/>]|$)/i.test(head) || /^<!DOCTYPE\s+svg\b/i.test(head)
    || head.startsWith('<!--') || head.startsWith('<?') || (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
}

// Positional reads preserve the caller's descriptor offset and never reopen a validated path.
// Non-regular inputs (including pipes used by the media timeout tests) remain FFmpeg's concern.
export async function readSvgSource(source) {
  const owned = typeof source === 'string';
  const handle = owned ? await open(source, constants.O_RDONLY | constants.O_NONBLOCK) : source;
  try {
    const info = await handle.stat();
    if (!info.isFile()) return null;
    const head = Buffer.alloc(Math.min(4096, info.size));
    await handle.read(head, 0, head.length, 0);
    if (!looksLikeSvg(head)) return null;
    if (info.size > SVG_LIMITS.bytes) fail(`source exceeds ${SVG_LIMITS.bytes} bytes`);
    const bytes = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) fail('source changed while reading');
    return looksLikeSvg(bytes) ? bytes : null;
  } finally { if (owned) await handle.close(); }
}

export function parseSvg(bytes, { namespace = null, stages = null } = {}) {
  if (Buffer.byteLength(bytes) > SVG_LIMITS.bytes) fail(`source exceeds ${SVG_LIMITS.bytes} bytes`);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes)); } catch { fail('source must be UTF-8 XML'); }
  // Reject declarations before XML parsing, even when an entity is never referenced.
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail('DTDs and entities are forbidden');
  let dom;
  try { dom = new JSDOM(source, { contentType: 'image/svg+xml' }); } catch { fail('malformed XML'); }
  try {
    const doc = dom.window.document, root = doc.documentElement;
    if (root.localName !== 'svg' || root.namespaceURI !== NS) fail('root must be svg in the SVG namespace');
    const nodes = [...doc.querySelectorAll('*')], ids = new Map(), references = [], fonts = new Set();
    if (nodes.length > SVG_LIMITS.elements) fail('too many elements');
    const walker = doc.createTreeWalker(doc, 64); // Processing instructions, including xml-stylesheet.
    if (walker.nextNode()) fail('processing instructions are forbidden');
    const styles = [];
    const reference = (node, id, allowed, accessibility = false) => { references.push({ node, id, allowed, accessibility }); };
    function value(node, name, val) {
      if (val.length > 100000) fail(`${name} is too long`);
      if (['fill', 'stroke', 'color', 'stop-color', 'flood-color'].includes(name)) {
        const ref = /^url\(#([A-Za-z_][A-Za-z0-9_-]{0,99})\)$/.exec(val);
        if (ref && ['fill', 'stroke'].includes(name)) return reference(node, ref[1], ['linearGradient', 'radialGradient']);
        if (!/^(?:none|currentColor|transparent|[a-zA-Z]+|#[a-fA-F0-9]{3,8}|rgba?\([\d.,%\s]+\))$/.test(val)) fail(`${name}: use a color or local gradient url(#id)`);
        const style = doc.createElementNS(NS, 'rect').style;
        style.setProperty('color', val === 'none' ? 'transparent' : val);
        if (!style.color) fail(`${name}: invalid color`);
        return;
      }
      if (['clip-path', 'mask', 'filter'].includes(name)) {
        if (val === 'none') return;
        const m = /^url\(#([A-Za-z_][A-Za-z0-9_-]{0,99})\)$/.exec(val);
        if (!m) fail(`${name}: only local url(#id) references are supported`);
        return reference(node, m[1], [{ 'clip-path': 'clipPath', mask: 'mask', filter: 'filter' }[name]]);
      }
      if (Object.hasOwn(enums, name)) { if (!enums[name].includes(val)) fail(`unsupported ${name}: ${val}`); return; }
      if (name === 'font-family') {
        const family = val.replace(/^(['"])(.*)\1$/, '$2');
        if (family !== 'Manrope' && !fontForFamily(family)) fail(`font-family ${val}: use one packaged catalogue family or Manrope`);
        fonts.add(family); return;
      }
      if (name === 'd') return pathData(val);
      if (name === 'points') { const n = numbers(val, name); if (n.length < 4 || n.length % 2) fail('points requires coordinate pairs'); return; }
      if (['transform', 'gradientTransform'].includes(name)) return transform(val);
      if (name === 'viewBox') { const n = numbers(val, name); if (n.length !== 4 || n[2] <= 0 || n[3] <= 0 || n[2] > 100000 || n[3] > 100000) fail('invalid viewBox'); return; }
      if (name === 'preserveAspectRatio') { if (!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(val)) fail('invalid preserveAspectRatio'); return; }
      if (name === 'href') { if (!/^#[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(val)) fail('href must be a local fragment'); return reference(node, val.slice(1), node.localName === 'use' ? ['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text'] : [node.localName]); }
      if (['in', 'in2', 'result'].includes(name)) { if (!ID.test(val)) fail(`invalid filter ${name}`); return; }
      if (name === 'stdDeviation') { const n = numbers(val, name, 0, 32); if (n.length > 2) fail('stdDeviation requires one or two numbers'); return; }
      if (node.localName === 'filter' && ['x', 'y', 'width', 'height'].includes(name)) {
        const positive = ['width', 'height'].includes(name);
        number(val.replace(/%$/, ''), `filter ${name}`, positive ? 0.01 : (val.endsWith('%') ? -100 : -1), val.endsWith('%') ? 200 : 2);
        return;
      }
      if (name === 'stroke-dasharray') { if (val !== 'none') numbers(val, name, 0, 10000); return; }
      if (name.endsWith('opacity') || name === 'offset') { number(val.replace(/%$/, ''), name, 0, val.endsWith('%') ? 100 : 1); return; }
      if (name === 'id') { if (!ID.test(val) || ids.has(val) || val !== node.getAttribute('id')) fail('IDs must be unique safe identifiers'); ids.set(val, node); return; }
      if (name === 'class') { if (!val.split(/\s+/).every(v => ID.test(v))) fail('invalid class names'); return; }
      if (['aria-labelledby', 'aria-describedby'].includes(name)) { for (const id of val.split(/\s+/)) reference(node, id, ['title', 'desc', 'text'], true); return; }
      if (['aria-label', 'data-stage', 'data-story-step'].includes(name)) return;
      if (name === 'role') { if (val !== 'img') fail('only role=img is supported'); return; }
      length(val, name, /^(width|height|r|rx|ry|fr|font-size|stroke-width|stroke-miterlimit|pathLength|textLength)$/.test(name) ? 0 : -100000);
    }
    function declarations(node, input) {
      if (/[{}@\\]|\/\*/.test(input)) fail('unsupported CSS syntax; use presentation declarations');
      const pairs = input.split(';').filter(s => s.trim()).map(part => {
        const m = /^\s*([a-z-]+)\s*:\s*(.*?)\s*$/.exec(part);
        if (!m || !presentation.has(m[1])) fail('unsupported CSS property; use presentation attributes (animation belongs to the deck runtime)');
        value(node, m[1], m[2]); return [m[1], m[2]];
      });
      return pairs;
    }
    for (const node of nodes) {
      const tag = node.localName;
      if (node.namespaceURI !== NS || !Object.hasOwn(elements, tag) || (tag === 'svg' && node !== root)) fail(`unsupported element ${node.tagName}`);
      if (node !== root && !validChild(node.parentElement.localName, tag)) fail(`unsupported ${tag} inside ${node.parentElement.localName}`);
      let depth = 0; for (let parent = node; parent; parent = parent.parentElement) depth++;
      if (depth > SVG_LIMITS.depth) fail('element nesting is too deep');
      for (const attr of node.attributes) {
        if (attr.name === 'xmlns' && node === root && attr.value === NS) continue;
        if (attr.name === 'xmlns:xlink' && node === root && attr.value === 'http://www.w3.org/1999/xlink') continue;
        const name = attr.name === 'xlink:href' && attr.namespaceURI === 'http://www.w3.org/1999/xlink' ? 'href' : attr.name;
        if ((attr.namespaceURI && name !== 'href') || (!globalAttrs.has(name) && !elements[tag].split(' ').includes(name))) fail(`unsupported attribute ${attr.name} on ${tag}`);
        if (name === 'style') declarations(node, attr.value); else value(node, name, attr.value.trim());
      }
      if (tag === 'style') {
        if (node.children.length) fail('style must contain CSS text');
        let rest = node.textContent.trim();
        while (rest) {
          const rule = /^([^{}]+)\{([^{}]*)\}\s*/.exec(rest);
          if (!rule) fail('unsupported CSS rule');
          const selectors = rule[1].trim().split(/\s*,\s*/);
          if (!selectors.every(s => /^[.#][A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(s))) fail('CSS selectors must be simple local .class or #id selectors');
          // Validate references on every matched node, so definition cycles cannot hide in CSS.
          const targets = [...root.querySelectorAll(selectors.join(','))];
          if (root.matches(selectors.join(','))) targets.push(root);
          for (const target of targets.length ? targets : [node]) declarations(target, rule[2]);
          styles.push({ node, selectors, declarations: declarations(node, rule[2]) });
          rest = rest.slice(rule[0].length);
        }
      }
      if (tag.startsWith('fe') && !['filter', 'feMerge'].includes(node.parentElement?.localName)) fail('filter primitives must be inside a filter');
    }
    if (nodes.filter(n => n.localName.startsWith('fe')).length > 32 || nodes.filter(n => n.localName === 'filter').length > 8) fail('too many filter effects');
    const edges = new Map(nodes.map(n => [n, [...n.children]]));
    for (const ref of references) {
      const target = ids.get(ref.id);
      if (!target || !ref.allowed.includes(target.localName)) fail(`missing or incompatible local reference #${ref.id}`);
      // Accessibility references do not expand geometry.
      if (!ref.accessibility) edges.get(ref.node).push(target);
    }
    const visiting = new Set(), counts = new Map();
    function count(node) {
      if (visiting.has(node)) fail('cyclic local references');
      if (counts.has(node)) return counts.get(node);
      visiting.add(node); let total = 1;
      for (const child of edges.get(node)) { total += count(child); if (total > SVG_LIMITS.expanded) fail('expanded geometry is too complex'); }
      visiting.delete(node); counts.set(node, total); return total;
    }
    count(root);
    const box = root.hasAttribute('viewBox') ? numbers(root.getAttribute('viewBox'), 'viewBox') : null;
    const dimension = (name, index) => root.hasAttribute(name) ? length(root.getAttribute(name), name, 0.01, SVG_LIMITS.dimension) : box?.[index];
    const width = dimension('width', 2), height = dimension('height', 3);
    if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= SVG_LIMITS.dimension) || ['width', 'height'].some(n => root.getAttribute(n)?.endsWith('%'))) fail('root needs finite pixel dimensions or a viewBox, at most 4096 per side');
    const groupIds = nodes.filter(n => n.localName === 'g' && n.id).map(n => n.id);
    const mapped = [];
    if (stages !== null) {
      validateVectorStages(stages, groupIds);
      for (const [index, stage] of stages.entries()) for (const id of stage.svgGroupIds) {
        const node = ids.get(id);
        if (node.closest('defs,clipPath,mask,pattern')) fail(`stage group ${id} must be visible geometry, not a definition`);
        mapped.push({ node, index });
      }
      for (const { node } of mapped) {
        if (mapped.some(other => other.node !== node && other.node.contains(node))) fail(`stage group ${node.id} cannot nest inside another mapped group`);
        if (references.some(ref => !ref.accessibility && ref.node.localName === 'use' && (ids.get(ref.id).contains(node) || node.contains(ids.get(ref.id))))) fail(`stage group ${node.id} cannot be reused by use; map independent visible groups`);
      }
    }
    if (namespace !== null) {
      if (!ID.test(namespace)) fail('invalid instance namespace');
      const renamed = id => `${namespace}-${id}`;
      for (const node of nodes) {
        for (const attr of [...node.attributes]) {
          let val = attr.value.trim();
          if (attr.name === 'id') val = renamed(val);
          else if (attr.name === 'class' || attr.name === 'aria-labelledby' || attr.name === 'aria-describedby') val = val.split(/\s+/).map(renamed).join(' ');
          else if (attr.localName === 'href') val = `#${renamed(val.slice(1))}`;
          else val = val.replace(/url\(#([^)]*)\)/g, (_, id) => `url(#${renamed(id)})`);
          node.setAttributeNS(attr.namespaceURI, attr.name, val);
        }
      }
      for (const node of nodes.filter(n => n.localName === 'style')) node.textContent = styles.filter(s => s.node === node).map(rule => `${rule.selectors.map(s => s[0] + renamed(s.slice(1))).join(',')}{${rule.declarations.map(([k, v]) => `${k}:${v.replace(/url\(#([^)]*)\)/g, (_, id) => `url(#${renamed(id)})`)}`).join(';')}}`).join('\n');
    }
    // Trusted wrappers preserve the author's opacity, transforms and selector IDs.
    // Runtime attributes are never accepted from source SVG.
    for (const { node, index } of mapped) {
      const wrapper = doc.createElementNS(NS, 'g');
      wrapper.setAttribute('data-vector-step', String(index));
      node.replaceWith(wrapper); wrapper.append(node);
    }
    return { profile: SVG_PROFILE, width, height, groupIds, fonts: [...fonts], source, svg: root.outerHTML };
  } finally { dom.window.close(); }
}

export function svgProbe(parsed) {
  return { kind: 'image', duration: null, width: parsed.width, height: parsed.height, hasAudio: false,
    contentType: 'image/svg+xml', svgProfile: parsed.profile, svgGroupIds: parsed.groupIds,
    streams: [{ codec_type: 'video', codec_name: 'svg', width: parsed.width, height: parsed.height }], format: { format_name: 'svg' } };
}

export function svgFontFiles(families) {
  const files = [new URL('./deck-template/assets/manrope-variable.ttf', import.meta.url).pathname];
  for (const family of families.filter(f => f !== 'Manrope')) {
    for (const weight of ['regular', 'bold']) {
      const file = fontPath(fontForFamily(family), weight);
      if (!file) fail(`packaged font unavailable: ${family} ${weight}`);
      files.push(file);
    }
  }
  return files;
}
