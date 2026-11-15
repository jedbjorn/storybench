/* Native 768 × 704 pixel illustrations. All motion is periodic and scrub-safe. */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const colors = ['#d5ad78', '#bc8f83', '#a2b7a0', '#8baeb3', '#d0c5a2', '#aba4bf'];
  const clamp = n => Math.max(0, Math.min(1, n));
  const ease = n => { n = clamp(n); return n * n * (3 - 2 * n); };
  const ramp = (t, a, b) => ease((t - a) / (b - a));
  const mix = (a, b, n) => a + (b - a) * n;
  const snap = n => Math.round(n);
  function rect(c, x, y, w, h, color) {
    if (w <= 0 || h <= 0) return;
    c.fillStyle = color;
    c.fillRect(snap(x), snap(y), snap(w), snap(h));
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
    c.clearRect(0, 0, 768, 704);
    c.save(); c.globalAlpha = 1;
  }
  function mosaic(c, raw, mode) {
    begin(c);
    const {t, gather, arrange, reveal, release} = phase(raw);
    const centerX = 384, centerY = 338;
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
      alpha(c, 1 - reveal, () => card(c, x, y, w, h, mode, i, t));
    }
    alpha(c, reveal, () => finished(c, 128, 176, 512, 320, mode, t));
    for (let i = 0; i < 7; i++) {
      const a = i * TAU / 7;
      const strength = .18 + .55 * (.5 + .5 * Math.sin(t * TAU + i * 1.7));
      sparkle(c, centerX + Math.cos(a) * 302, centerY + Math.sin(a) * 272, strength);
    }
    c.restore();
  }
  function mat(c) {
    alpha(c, .07, () => ellipse(c, 411, 594, 300, 35, '#344d40'));
    polygon(c, [[167,498],[685,498],[730,582],[114,582]], '#2d4c41');
    polygon(c, [[169,499],[683,499],[722,577],[123,577]], '#79917a');
    polygon(c, [[174,504],[677,504],[713,571],[133,571]], '#3f6452');
    polygon(c, [[180,509],[672,509],[704,566],[142,566]], '#476c58');
    for (let x = 186; x < 671; x += 12) rect(c, x, 512, 5, 2, '#9da483');
    for (let x = 148; x < 704; x += 12) rect(c, x, 562, 5, 2, '#97a181');
    for (let y = 518; y < 560; y += 9) {
      const inset = (y - 510) * .6;
      rect(c, 180 - inset, y, 3, 3, '#97a181');
      rect(c, 674 + inset, y, 3, 3, '#97a181');
    }
    for (let i = 0; i < 90; i++) rect(c, 190 + i * 73 % 460, 520 + i * 17 % 34, i % 3 + 1, 1, '#51735c');
    rect(c, 123, 579, 599, 4, '#29493e');
  }
  function lamp(c, t) {
    // Restrained warm light on transparent space, without a room or backdrop.
    alpha(c, .055, () => polygon(c, [[212,225],[280,225],[645,533],[245,533]], '#ddbe65'));
    alpha(c, .045, () => polygon(c, [[221,229],[273,229],[571,525],[287,525]], '#e8c96c'));
    alpha(c, .1, () => ellipse(c, 138, 567, 88, 12, '#345043'));
    ellipse(c, 138, 554, 78, 16, '#385346');
    ellipse(c, 138, 549, 76, 15, '#6d8060');
    ellipse(c, 138, 544, 66, 12, '#98a17a');
    ellipse(c, 138, 541, 52, 8, '#adb18a');
    rect(c, 127, 517, 21, 25, '#5e7257');
    rect(c, 129, 517, 5, 24, '#d1c18a');
    line(c, 134, 523, 94, 357, '#344e43', 15);
    line(c, 137, 519, 99, 359, '#a99b6b', 8);
    line(c, 139, 515, 101, 359, '#e0cc8d', 3);
    line(c, 94, 356, 206, 203, '#344e43', 16);
    line(c, 99, 355, 209, 205, '#b7a572', 8);
    line(c, 102, 355, 211, 205, '#e2d095', 3);
    // A parallel spring and tiny machined joints make this a lamp, not a stick.
    line(c, 115, 365, 145, 497, '#7c805e', 3);
    for (let i = 0; i < 16; i++) line(c, 119 + i * 1.5, 385 + i * 6, 127 + i * 1.5, 381 + i * 6, '#b1ac80', 2);
    ellipse(c, 101, 361, 16, 16, '#4c6551');
    ellipse(c, 101, 359, 12, 12, '#b8ac78');
    ellipse(c, 101, 359, 5, 5, '#5d7156');
    rect(c, 98, 357, 6, 2, '#d8c58b');
    ellipse(c, 212, 208, 13, 13, '#71805e');
    ellipse(c, 212, 207, 5, 5, '#ccb982');
    // Enamel shade, bevels, warm inner rim and fine reflective pixels.
    rect(c, 222, 169, 36, 9, '#4e6a55');
    rect(c, 225, 166, 30, 5, '#829774');
    polygon(c, [[217,177],[266,177],[295,223],[184,223]], '#45634f');
    polygon(c, [[222,179],[262,179],[285,217],[194,217]], '#829774');
    polygon(c, [[226,180],[240,180],[226,216],[199,216]], '#a5b18a');
    polygon(c, [[259,180],[267,191],[284,217],[269,217]], '#607d60');
    rect(c, 182, 218, 115, 8, '#3f5e4b');
    rect(c, 185, 219, 109, 3, '#aab58a');
    rect(c, 190, 226, 99, 5, '#d4b978');
    rect(c, 201, 230, 78, 4, '#f1dca0');
    rect(c, 221, 234, 34, 3, '#fff0bd');
    alpha(c, .45 + .1 * Math.sin(t * TAU), () => rect(c, 199, 217, 73, 2, '#fff4c9'));
  }
  function desk(c, raw, mode) {
    begin(c);
    const {t, gather, arrange, reveal, release} = phase(raw);
    mat(c); lamp(c, t);
    const start = [[323,155],[495,126],[632,191],[302,334],[511,279],[645,378]];
    for (let i = 0; i < 6; i++) {
      const sx = start[i][0] + Math.sin(t * TAU + i) * 9;
      const sy = start[i][1] + Math.cos(t * TAU + i * .8) * 8;
      const looseX = 370 + Math.cos(i * 2.4) * 81;
      const looseY = 340 + Math.sin(i * 2.4) * 68;
      const gx = 279 + i % 3 * 132, gy = 292 + Math.floor(i / 3) * 100;
      let x = mix(mix(sx, looseX, gather), gx, arrange);
      let y = mix(mix(sy, looseY, gather), gy, arrange);
      x = mix(x, sx, release); y = mix(y, sy, release);
      const w = mix(mix(83, 124, arrange), 83, release);
      const h = mix(mix(69, 92, arrange), 69, release);
      alpha(c, 1 - reveal, () => card(c, x, y, w, h, mode, i, t));
    }
    alpha(c, reveal, () => finished(c, 281, 262, 402, 249, mode, t));
    for (let i = 0; i < 3; i++) sparkle(c, 340 + i * 161, 223 - i % 2 * 24, .15 + reveal * .55 + .1 * Math.sin(t * TAU + i));
    c.restore();
  }
  window.ThinkingArt = { mosaic, desk };
})();
