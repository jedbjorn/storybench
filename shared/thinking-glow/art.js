/* Native 960 × 880 mosaic studies. Geometry is rasterized at the new resolution. */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const RESOLUTION = 1.25;
  const colors = ['#d5ad78', '#bc8f83', '#a2b7a0', '#8baeb3', '#d0c5a2', '#aba4bf'];
  const clamp = n => Math.max(0, Math.min(1, n));
  const ease = n => { n = clamp(n); return n * n * (3 - 2 * n); };
  const ramp = (t, a, b) => ease((t - a) / (b - a));
  const mix = (a, b, n) => a + (b - a) * n;
  const snap = n => Math.round(n);
  function rect(c, x, y, w, h, color) {
    if (w <= 0 || h <= 0) return;
    c.fillStyle = color;
    c.fillRect(snap(x * RESOLUTION), snap(y * RESOLUTION), snap(w * RESOLUTION), snap(h * RESOLUTION));
  }
  function alpha(c, amount, draw) {
    if (amount <= 0) return;
    c.save(); c.globalAlpha *= clamp(amount); draw(); c.restore();
  }
  function line(c, x, y, xx, yy, color, width = 2) {
    x = snap(x / 2); y = snap(y / 2); xx = snap(xx / 2); yy = snap(yy / 2);
    const dx = Math.abs(xx - x), sx = x < xx ? 1 : -1;
    const dy = -Math.abs(yy - y), sy = y < yy ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      rect(c, x * 2, y * 2, width, width, color);
      if (x === xx && y === yy) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x += sx; }
      if (twice <= dx) { error += dx; y += sy; }
    }
  }
  function polygon(c, points, color) {
    const ymin = Math.floor(Math.min(...points.map(p => p[1])) / 2) * 2;
    const ymax = Math.ceil(Math.max(...points.map(p => p[1])) / 2) * 2;
    for (let y = ymin; y < ymax; y += 2) {
      const hits = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          hits.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      }
      hits.sort((a, b) => a - b);
      for (let i = 0; i + 1 < hits.length; i += 2) rect(c, hits[i], y, hits[i + 1] - hits[i], 2, color);
    }
  }
  function ellipse(c, x, y, rx, ry, color) {
    for (let dy = -ry; dy <= ry; dy += 2) {
      const half = rx * Math.sqrt(Math.max(0, 1 - dy * dy / (ry * ry)));
      rect(c, x - half, y + dy, half * 2, 2, color);
    }
  }
  function sparkle(c, x, y, amount, color = '#a7b38c') {
    alpha(c, amount, () => {
      rect(c, x - 6, y, 14, 2, color);
      rect(c, x, y - 6, 2, 14, color);
      rect(c, x - 2, y - 2, 6, 6, '#dfc888');
      rect(c, x, y, 2, 2, '#fff4cc');
    });
  }
  // Small illustrated landscapes retain details at a 4.5:1 display reduction.
  function landscape(c, x, y, w, h, variant, time) {
    rect(c, x, y, w, h, '#a8c1c0');
    rect(c, x, y + h * .39, w, h * .61, '#b9cdbe');
    const sun = Math.max(5, w * .07);
    ellipse(c, x + w * .78, y + h * .21, sun, sun, '#f9e6ac');
    const drift = Math.sin(time * TAU) * w * .025;
    rect(c, x + w * .13 + drift, y + h * .19, w * .23, h * .035, '#eef0d9');
    rect(c, x + w * .18 + drift, y + h * .15, w * .12, h * .04, '#eef0d9');
    polygon(c, [[x,y+h*.74],[x+w*.2,y+h*.3],[x+w*.48,y+h*.77],[x+w*.69,y+h*.44],[x+w,y+h*.8],[x+w,y+h],[x,y+h]], '#7e9b8b');
    polygon(c, [[x,y+h*.86],[x+w*.36,y+h*.6],[x+w*.64,y+h*.85],[x+w*.82,y+h*.57],[x+w,y+h*.73],[x+w,y+h],[x,y+h]], '#4c766c');
    polygon(c, [[x+w*.45,y+h],[x+w*.58,y+h*.73],[x+w*.62,y+h*.73],[x+w*.57,y+h]], '#b4bea1');
    if (w > 85) {
      const bx = x + w * .2, by = y + h * .78;
      rect(c, bx, by, w * .23, 4, '#d5b17b');
      rect(c, bx, by + 7, w * .23, 4, '#b69062');
      rect(c, bx - 2, by + 15, w * .27, 5, '#e2c293');
      rect(c, bx + 4, by + 20, 4, 11, '#385c51');
      rect(c, bx + w * .19, by + 20, 4, 11, '#385c51');
      const tx = x + w * .77, ty = y + h * .66;
      rect(c, tx, ty - 20, 4, 40, '#426458');
      ellipse(c, tx + 2, ty - 29, 15, 21, '#527f67');
      ellipse(c, tx - 4, ty - 33, 9, 14, '#709478');
      if (variant % 2) rect(c, x + w * .59, y + h * .72, 6, 14, '#d5ac86');
    }
  }
  function slide(c, x, y, w, h, variant, color) {
    rect(c, x, y, w, h, '#f5eedb');
    rect(c, x, y, Math.max(3, w * .025), h, color);
    rect(c, x + w * .09, y + h * .11, w * .59, Math.max(2, h * .045), '#3b5a51');
    rect(c, x + w * .09, y + h * .22, w * .36, Math.max(1, h * .018), '#a0ad94');
    if (variant % 3 === 0) {
      landscape(c, x + w * .09, y + h * .36, w * .4, h * .47, 0, 0);
      for (let j = 0; j < 4; j++) rect(c, x + w * .56, y + h * (.38 + j * .11), w * (.32 - j % 2 * .07), Math.max(1, h * .024), j ? '#a6b098' : '#6c8b77');
    } else if (variant % 3 === 1) {
      const bottom = y + h * .84;
      rect(c, x + w * .1, bottom, w * .76, 2, '#b1b9a1');
      for (let j = 0; j < 4; j++) {
        const height = h * (.16 + j * .105);
        rect(c, x + w * (.14 + j * .18), bottom - height, w * .11, height, j === 3 ? '#527b6b' : color);
        rect(c, x + w * (.14 + j * .18), bottom - height, w * .11, 2, '#dce0c3');
      }
    } else {
      for (let j = 0; j < 3; j++) {
        const yy = y + h * (.4 + j * .17);
        rect(c, x + w * .1, yy, w * .07, h * .08, color);
        rect(c, x + w * .24, yy, w * (.59 - j % 2 * .12), Math.max(2, h * .025), '#779482');
        rect(c, x + w * .24, yy + h * .065, w * .4, Math.max(1, h * .015), '#b1b9a1');
      }
    }
    rect(c, x + w * .83, y + h * .93, w * .08, 2, '#a7b397');
  }
  function card(c, x, y, w, h, mode, i, time) {
    alpha(c, .14, () => rect(c, x + 5, y + 7, w, h, '#365249'));
    rect(c, x, y, w, h, '#567568');
    rect(c, x + 2, y + 2, w - 4, h - 4, colors[i % 6]);
    rect(c, x + 3, y + 3, w - 6, 2, '#f3e8c8');
    if (mode === 'video') {
      landscape(c, x + 6, y + 12, w - 12, h - 24, i, time);
      rect(c, x + 4, y + 5, w - 8, 6, '#34534c');
      rect(c, x + 4, y + h - 11, w - 8, 6, '#34534c');
      for (let xx = 7; xx < w - 7; xx += 12) {
        rect(c, x + xx, y + 6, 5, 3, '#e7d8ad');
        rect(c, x + xx, y + h - 9, 5, 3, '#e7d8ad');
      }
    } else slide(c, x + 5, y + 6, w - 10, h - 12, i, colors[i % 6]);
  }
  function finished(c, x, y, w, h, mode, time) {
    if (mode === 'video') {
      alpha(c, .1, () => rect(c, x + 7, y + 10, w, h, '#365249'));
      rect(c, x, y, w, h, '#36584e');
      rect(c, x + 3, y + 3, w - 6, h - 6, '#d9c99d');
      rect(c, x + 7, y + 7, w - 14, h - 14, '#3f6055');
      landscape(c, x + 14, y + 26, w - 28, h - 52, 1, time);
      for (let xx = 14; xx < w - 17; xx += 24) {
        rect(c, x + xx, y + 11, 12, 7, '#e9dcb5');
        rect(c, x + xx, y + h - 18, 12, 7, '#e9dcb5');
      }
      rect(c, x + w / 2 - 26, y + h, 52, 21, '#36584e');
      polygon(c, [[x+w/2-4,y+h+5],[x+w/2+8,y+h+11],[x+w/2-4,y+h+17]], '#e8d8ae');
    } else {
      for (let i = 2; i >= 0; i--) {
        rect(c, x + i * 13 + 4, y + i * 12 + 6, w - 26, h - 24, '#c0cbb5');
        rect(c, x + i * 13, y + i * 12, w - 26, h - 24, i ? '#819d87' : '#53796b');
        slide(c, x + i * 13 + 3, y + i * 12 + 3, w - 32, h - 30, i, colors[i + 2]);
        rect(c, x + i * 13 + 3, y + i * 12 + 3, w - 32, 2, '#fff8e5');
      }
    }
  }
  const treatments = {
    amber: { kind: 'amber', color: [218, 166, 64], rim: '#efd59a' },
    mint: { kind: 'mint', color: [64, 178, 140], rim: '#b5efda' },
    prism: { kind: 'prism', color: [155, 130, 211], rim: '#e0d6f4' },
  };
  function pulse(t, center, radius) {
    const distance = Math.abs(t - center) / radius;
    return distance >= 1 ? 0 : .5 + .5 * Math.cos(distance * Math.PI);
  }
  function beats(t) {
    return {
      assembly: pulse(t, .49, .065),
      output: pulse(t, .64, .085),
    };
  }
  // Soft light is painted below the crisp artwork. These are colored halos,
  // not additive white flashes that would wash out details on the light chat.
  function halo(c, x, y, radius, rgb, intensity) {
    if (intensity <= 0) return;
    x *= RESOLUTION; y *= RESOLUTION; radius *= RESOLUTION;
    const gradient = c.createRadialGradient(x, y, 0, x, y, radius);
    const color = a => `rgba(${rgb.join(',')},${a})`;
    gradient.addColorStop(0, color(intensity));
    gradient.addColorStop(.28, color(intensity * .8));
    gradient.addColorStop(.65, color(intensity * .24));
    gradient.addColorStop(1, color(0));
    c.fillStyle = gradient;
    c.fillRect(snap(x - radius), snap(y - radius), snap(radius * 2), snap(radius * 2));
  }
  function ambient(c, glow, light, t) {
    const breath = .95 + .05 * Math.cos(t * TAU);
    const a = light.assembly, o = light.output;
    if (glow.kind === 'amber') {
      halo(c, 384, 340, 315 + a * 15 + o * 25, glow.color, (.13 + a * .17 + o * .23) * breath);
      halo(c, 384, 334, 200, [245, 209, 118], .05 + a * .1 + o * .14);
    } else if (glow.kind === 'mint') {
      halo(c, 384, 340, 292, glow.color, .045 + a * .1 + o * .12);
    } else {
      const drift = Math.sin(t * TAU) * 12;
      halo(c, 340 + drift, 330, 306, glow.color, .12 + a * .13 + o * .17);
      halo(c, 434 - drift, 346, 270, [220, 156, 165], .055 + a * .08 + o * .15);
      halo(c, 384, 334, 232, [239, 194, 119], a * .2 + o * .28);
    }
  }
  function tileGlow(c, x, y, w, h, glow, light, i, t) {
    const a = light.assembly, o = light.output;
    const shimmer = .94 + .06 * Math.sin(t * TAU + i * .8);
    const intensity = glow.kind === 'mint' ? .16 + a * .34 + o * .12 : .1 + a * .2 + o * .1;
    const radius = Math.max(w, h) * (glow.kind === 'mint' ? .88 : 1.1);
    halo(c, x + w / 2, y + h / 2, radius, glow.color, intensity * shimmer);
    if (glow.kind === 'mint') {
      alpha(c, .18 + a * .48, () => {
        rect(c, x - 2, y - 2, w + 4, 2, '#88d4ba');
        rect(c, x - 2, y + h, w + 4, 2, '#88d4ba');
        rect(c, x - 2, y, 2, h, '#88d4ba');
        rect(c, x + w, y, 2, h, '#88d4ba');
      });
    }
  }
  function outputGlow(c, glow, light) {
    const power = light.output;
    if (glow.kind === 'mint') {
      // Multiple narrow pools follow the output's border rather than its center.
      for (let i = 0; i < 16; i++) {
        halo(c, 142 + i * 32, 185, 64, glow.color, .065 + power * .13);
        halo(c, 142 + i * 32, 487, 64, glow.color, .05 + power * .11);
      }
      for (let i = 1; i < 6; i++) {
        halo(c, 136, 192 + i * 48, 64, glow.color, .07 + power * .13);
        halo(c, 630, 192 + i * 48, 64, glow.color, .07 + power * .13);
      }
    } else {
      halo(c, 384, 336, 332, glow.color, .12 + power * .23);
      if (glow.kind === 'prism') halo(c, 384, 306, 275, [240, 194, 120], power * .23);
    }
  }
  function highlights(c, x, y, w, h, glow, light, i, t, output = false) {
    const beat = output ? light.output : light.assembly;
    // One-native-pixel accents use the added resolution instead of enlarging
    // the old raster. They stay fine even when the glow is at its brightest.
    alpha(c, .3 + beat * .65, () => {
      c.fillStyle = glow.rim;
      c.fillRect(snap((x + 3) * RESOLUTION), snap((y + 2) * RESOLUTION), snap((w - 6) * RESOLUTION), 1);
      c.fillRect(snap((x + 3) * RESOLUTION), snap((y + 3) * RESOLUTION), 1, snap((h * .34) * RESOLUTION));
    });
    if (glow.kind === 'mint') {
      alpha(c, .12 + beat * .35, () => {
        rect(c, x + 1, y, w - 2, 2, '#e1fff0');
        rect(c, x, y + 1, 2, h - 2, '#c8f4df');
      });
    } else if (glow.kind === 'prism') {
      const shine = .08 + beat * .75;
      if (output || i % 5 === 0) {
        sparkle(c, x + w - 3, y + 3, shine, '#baabd9');
        halo(c, x + w - 3, y + 3, output ? 42 : 22, [235, 195, 139], shine * .4);
      }
    }
  }
  function phase(raw) {
    const t = ((raw % 1) + 1) % 1;
    return {
      t,
      gather: ramp(t, .02, .25),
      arrange: ramp(t, .26, .49),
      reveal: ramp(t, .51, .62) * (1 - ramp(t, .76, .86)),
      release: ramp(t, .79, .99),
    };
  }
  function begin(c) {
    c.clearRect(0, 0, 960, 880);
    c.save(); c.globalAlpha = 1;
  }
  function mosaic(c, raw, mode, treatment = 'amber') {
    begin(c);
    const {t, gather, arrange, reveal, release} = phase(raw);
    const centerX = 384, centerY = 338;
    const light = beats(t);
    const glow = treatments[treatment];
    ambient(c, glow, light, t);
    // The same fragments survive the full cycle; nothing resets or teleports.
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.399963;
      const bob = Math.sin(t * TAU + i * .7);
      const ox = centerX + Math.cos(angle) * (230 + i % 3 * 25);
      const oy = centerY + Math.sin(angle) * (217 + i % 4 * 9);
      const startX = ox - 30 + bob * 8;
      const startY = oy - 27 + Math.cos(t * TAU + i) * 8;
      const looseX = centerX + Math.cos(angle) * (125 + i % 3 * 18) - 34;
      const looseY = centerY + Math.sin(angle) * (100 + i % 4 * 14) - 28;
      const gridX = 138 + i % 6 * 82, gridY = 192 + Math.floor(i / 6) * 72;
      let x = mix(mix(startX, looseX, gather), gridX, arrange);
      let y = mix(mix(startY, looseY, gather), gridY, arrange);
      x = mix(x, startX, release); y = mix(y, startY, release);
      const w = mix(mix(60, 80, arrange), 60, release);
      const h = mix(mix(54, 70, arrange), 54, release);
      alpha(c, 1 - reveal, () => {
        tileGlow(c, x, y, w, h, glow, light, i, t);
        card(c, x, y, w, h, mode, i, t);
        highlights(c, x, y, w, h, glow, light, i, t);
      });
    }
    alpha(c, reveal, () => {
      outputGlow(c, glow, light);
      finished(c, 128, 176, 512, 320, mode, t);
      highlights(c, 128, 176, 512, 320, glow, light, 0, t, true);
    });
    for (let i = 0; i < 7; i++) {
      const a = i * TAU / 7;
      const strength = .18 + .55 * (.5 + .5 * Math.sin(t * TAU + i * 1.7));
      sparkle(c, centerX + Math.cos(a) * 302, centerY + Math.sin(a) * 272, strength);
    }
    c.restore();
  }
  window.MosaicGlow = { draw: mosaic, beats };
})();
