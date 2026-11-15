/* Storybench motion studies 03 + 04. Standalone, deterministic pixel scenes. */
(() => {
  'use strict';
  const W = 384, H = 216;
  const clamp = n => Math.max(0, Math.min(1, n));
  const ease = n => { n = clamp(n); return n * n * (3 - 2 * n); };
  const mix = (a, b, n) => a + (b - a) * n;
  const R = (c, x, y, w, h, col) => {
    c.fillStyle = col;
    c.fillRect(Math.round(x), Math.round(y), Math.max(0, Math.round(w)), Math.max(0, Math.round(h)));
  };
  // All marks, including diagonals and circles, are painted on the pixel grid.
  function L(c, x, y, xx, yy, col, thick = 1) {
    x = Math.round(x); y = Math.round(y); xx = Math.round(xx); yy = Math.round(yy);
    const dx = Math.abs(xx - x), sx = x < xx ? 1 : -1;
    const dy = -Math.abs(yy - y), sy = y < yy ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      R(c, x, y, thick, thick, col);
      if (x === xx && y === yy) break;
      const e2 = error * 2;
      if (e2 >= dy) { error += dy; x += sx; }
      if (e2 <= dx) { error += dx; y += sy; }
    }
  }
  function E(c, x, y, rx, ry, col) {
    rx = Math.round(rx); ry = Math.round(ry);
    if (rx <= 0 || ry <= 0) return;
    for (let iy = -ry; iy <= ry; iy++) {
      const span = Math.floor(rx * Math.sqrt(Math.max(0, 1 - iy * iy / (ry * ry))));
      R(c, x - span, y + iy, span * 2 + 1, 1, col);
    }
  }
  function P(c, pts, col) {
    const lo = Math.ceil(Math.min(...pts.map(p => p[1])));
    const hi = Math.floor(Math.max(...pts.map(p => p[1])));
    for (let y = lo; y <= hi; y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
          xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      xs.sort((a, b) => a - b);
      for (let j = 0; j + 1 < xs.length; j += 2) R(c, Math.ceil(xs[j]), y, Math.floor(xs[j + 1]) - Math.ceil(xs[j]) + 1, 1, col);
    }
  }
  function star(c, x, y, col, size = 2) {
    R(c, x - size, y, size * 2 + 1, 1, col);
    R(c, x, y - size, 1, size * 2 + 1, col);
    if (size > 2) { R(c, x - 1, y - 1, 3, 3, col); }
  }
  function bolt(c, x, y) {
    R(c, x - 2, y - 1, 5, 3, '#35463e'); R(c, x - 1, y - 2, 3, 5, '#35463e');
    R(c, x - 1, y - 1, 3, 3, '#c3986a'); R(c, x, y, 2, 1, '#685f4b');
  }
  function picture(c, x, y, w, h, i, movement = 0) {
    R(c, x, y, w, h, i % 3 === 2 ? '#677e87' : '#547d80');
    R(c, x, y + Math.floor(h * .55), w, Math.ceil(h * .45), '#7b9b92');
    E(c, x + w * (.72 - (i % 3) * .13), y + h * .25, Math.max(1, w * .065), Math.max(1, w * .065), '#e4d2a1');
    P(c, [[x,y+h-1],[x+w*(.22+(i%3)*.09),y+h*(.27+(i%3)*.1)],[x+w*.52,y+h-1]], '#345c68');
    P(c, [[x+w*.28,y+h-1],[x+w*(.61+(i%2)*.11),y+h*(.46-(i%3)*.07)],[x+w-1,y+h-1]], '#284c59');
    const cx = x + w * .17 + movement;
    R(c, cx, y + h * .19, w * .22, 1, '#abc6b4');
    R(c, cx + 2, y + h * .19 - 1, w * .10, 1, '#abc6b4');
    if (i % 2) L(c, x + w * .55, y + h * .66, x + w * .43, y + h - 1, '#c3b891');
    if (w > 30 && h > 20) {
      if (i % 3 === 0) {
        R(c,x+2,y+h-6,w-4,4,'#638d8d');
        R(c,x+w*.58,y+h-5,w*.23,1,'#b5bca0');
        R(c,x+w*.45,y+h-3,w*.17,1,'#8ea89a');
      } else if (i % 3 === 1) {
        const tx=x+w*.81, ty=y+h-4;
        R(c,tx,ty-9,1,11,'#b4b48d');
        P(c,[[tx-5,ty-3],[tx,ty-14],[tx+5,ty-3]],'#1e454b');
        P(c,[[tx-4,ty-7],[tx,ty-17],[tx+4,ty-7]],'#315c5a');
      } else {
        const hx=x+w*.65, hy=y+h-9;
        R(c,hx,hy,8,7,'#b7a37b');
        P(c,[[hx-2,hy],[hx+4,hy-5],[hx+10,hy]],'#1a3944');
        R(c,hx+2,hy+2,2,3,'#e9cc91'); R(c,hx+6,hy+3,2,4,'#4c6259');
      }
    }
  }
  function slide(c, x, y, w, h, i) {
    R(c, x, y, w, h, '#e3d9b7');
    R(c, x + 3, y + 3, w * .58, 2, '#3c5c5a');
    if (i % 3 === 0) {
      picture(c, x + 3, y + 8, Math.floor(w * .43), h - 11, i);
      for (let j = 0; j < 3; j++) R(c, x + w * .54, y + 9 + j * 4, w * (.30 - (j % 2) * .07), 1, '#819184');
    } else if (i % 3 === 1) {
      for (let j = 0; j < 3; j++) {
        const bh = (h - 12) * (.4 + j * .26);
        R(c, x + 5 + j * Math.floor(w / 5), y + h - 4 - bh, Math.max(3, w / 8), bh, j === 2 ? '#bd895f' : '#729489');
      }
      R(c, x + 3, y + h - 3, w - 6, 1, '#a7ac93');
    } else {
      for (let j = 0; j < 3; j++) {
        R(c, x + 4, y + 9 + j * 5, 2, 2, '#af8059');
        R(c, x + 9, y + 9 + j * 5, w * (.61 - (j % 2) * .11), 2, '#8a9b89');
      }
    }
  }
  function token(c, x, y, mode, i, scale = 1) {
    x = Math.round(x); y = Math.round(y);
    const w = Math.round(20 * scale), h = Math.round(15 * scale);
    if (w < 4 || h < 4) { star(c, x, y, '#e7d6a4', 1); return; }
    x -= Math.floor(w / 2); y -= Math.floor(h / 2);
    R(c, x + 1, y + 2, w, h, '#0b2029');
    R(c, x, y, w, h, mode === 'video' ? '#b3bfaa' : '#d8c79c');
    if (mode === 'video') {
      picture(c, x + 2, y + 3, w - 4, h - 6, i);
      for (let j = 2; j < w - 2; j += 5) { R(c, x + j, y + 1, 2, 1, '#29484e'); R(c, x + j, y + h - 2, 2, 1, '#29484e'); }
    } else {
      R(c, x + 3, y + 3, w - 7, 2, '#496e64');
      if (i % 2) {
        R(c, x + 3, y + 7, w - 6, 1, '#819780'); R(c, x + 3, y + 10, w - 9, 1, '#819780');
      } else {
        for (let j = 0; j < 3; j++) R(c, x + 3 + j * 4, y + h - 3 - j * 2, 3, 2 + j * 2, '#668b7c');
      }
    }
  }
  const sky = { bg: '#0a1727', blue: '#102638', teal: '#20484f', pale: '#ebdbaa', dim: '#456b70' };
  function night(c, t) {
    R(c, 0, 0, W, H, sky.bg);
    // Broad, dithered galactic ribbons. Fixed arithmetic noise, never random state.
    for (let y = 4; y < 183; y += 3) for (let x = 4; x < 382; x += 3) {
      const band = Math.abs(y - (122 - x * .22 + Math.sin(x * .022) * 13));
      const hash = (x * 37 + y * 71 + x * y) % 113;
      if (band < 42 && hash < 26) R(c, x, y, 2, 1, band < 21 ? '#17333f' : '#102535');
      if (band < 14 && hash < 6) R(c, x, y, 1, 1, '#285057');
    }
    for (let i = 0; i < 116; i++) {
      const x = 7 + (i * 67 + i * i * 3) % 369, y = 7 + (i * 43 + i * i * 7) % 178;
      R(c, x, y, 1, 1, i % 7 ? '#45606d' : '#94a9a1');
    }
    [[33,28],[81,18],[337,39],[354,111],[36,143],[291,22],[157,31]].forEach((q, i) => {
      star(c, q[0], q[1], i % 2 ? '#8aa9a2' : '#c9c79f', i % 3 ? 1 : 2);
    });
    // A little eclipsed moon with a stepped rim.
    E(c, 349, 23, 10, 10, '#48665f'); E(c, 346, 21, 9, 9, '#c1c8a3'); E(c, 342, 18, 9, 9, sky.bg);
    P(c, [[0,187],[28,170],[49,181],[73,161],[99,182],[122,172],[155,191],[191,180],[217,190],[257,165],[281,180],[308,163],[338,180],[362,171],[384,183],[384,216],[0,216]], '#142d39');
    P(c, [[0,198],[41,181],[65,192],[97,183],[128,200],[171,187],[215,200],[256,184],[299,198],[336,182],[384,197],[384,216],[0,216]], '#0c202e');
    for (let i = 0; i < 19; i++) R(c, 8 + i * 21, 200 + (i % 3) * 3, 9, 1, '#29434a');
    // Brass observatory instrument in silhouette, grounding the magic in a place.
    E(c, 35, 200, 20, 3, '#07151e');
    L(c, 35, 181, 23, 203, '#4e6865', 2); L(c, 35, 181, 46, 203, '#4e6865', 2);
    L(c, 35, 183, 35, 205, '#829084', 2);
    P(c, [[20,175],[26,183],[52,164],[46,157]], '#7d8a78');
    P(c, [[20,175],[22,178],[48,160],[46,157]], '#c1b992');
    L(c, 45, 156, 53, 165, '#3c595b', 3); R(c, 33, 181, 6, 4, '#ab9f7a');
    // Bottom map plinth, small quiet surveying marks.
    R(c, 79, 202, 226, 1, '#36565c'); R(c, 102, 206, 180, 1, '#1c3944');
    for (let i = 0; i < 21; i++) R(c, 92 + i * 10, 200, 1, i % 5 ? 2 : 4, '#5a716e');
    star(c, 326, 198, '#8a9e8c', 2);
  }
  function constellation(c, rawT, mode, _kit) {
    c.save(); c.globalAlpha = 1;
    const t = Math.min(.95, Math.max(0, rawT));
    const gather = ease(t * 3), arrange = ease((t - 1 / 3) * 3), bloom = ease((t - 2 / 3) / .25);
    const video = mode === 'video';
    night(c, t);
    const origin = [[45,61],[118,33],[246,40],[337,78],[290,154],[65,149]];
    const orbit = [[130,79],[188,61],[250,82],[249,135],[189,153],[129,133]];
    const grid = video ? [[101,79],[192,79],[283,79],[101,139],[192,139],[283,139]]
                       : [[103,76],[192,76],[281,76],[103,139],[192,139],[281,139]];
    const positions = origin.map((p, i) => {
      const drift = Math.sin(t * 15 + i * 1.8) * 3 * (1 - gather);
      return [mix(mix(p[0], orbit[i][0], gather), grid[i][0], arrange), mix(mix(p[1], orbit[i][1], gather) + drift, grid[i][1], arrange)];
    });
    // A dim circular astrolabe remains visible behind the ordered constellation.
    for (let i = 0; i < 64; i++) {
      const a = i * Math.PI / 32;
      R(c, 192 + Math.cos(a) * 109, 108 + Math.sin(a) * 77, i % 4 ? 1 : 2, 1, '#294a54');
    }
    const coreFade = 1 - arrange;
    if (coreFade > 0) {
      c.globalAlpha = coreFade;
      const rad = 10 + 2 * Math.sin(t * 21);
      E(c, 192, 106, rad + 13, rad + 9, '#142f3c');
      E(c, 192, 106, rad + 5, rad + 3, '#21454c');
      E(c, 192, 106, rad, rad, '#365c59');
      E(c, 192, 106, 5 * coreFade + 1, 5 * coreFade + 1, '#b4bc8c');
      star(c, 192, 106, sky.pale, 5);
      for (let i = 0; i < 6; i++) {
        const p = positions[i];
        for (let j = 0; j < 5; j++) {
          const f = ((t * 1.2 + j / 5 + i * .12) % 1);
          const x = mix(p[0], 192, f), y = mix(p[1], 106, f);
          if (f > .2 && f < .86) R(c, x, y, 1, 1, '#7b9c88');
        }
      }
    }
    c.globalAlpha = 1;
    // Lines build in reading order while the still-small stars settle into place.
    if (t >= 1 / 3) {
      const edges = video ? [[0,1],[1,2],[2,5],[5,4],[4,3]] : [[1,0],[1,2],[0,3],[1,4],[2,5]];
      edges.forEach((edge, i) => {
        const a = positions[edge[0]], b = positions[edge[1]];
        const draw = ease(((t - 1 / 3) * 3) * 2.2 - i * .23);
        if (draw > 0) {
          if (video && i === 2) {
            const bx = 326, yy = mix(a[1], b[1], draw);
            L(c, a[0], a[1], bx, a[1], '#597b78'); L(c, bx, a[1], bx, yy, '#597b78');
            if (draw > .8) L(c, bx, b[1], mix(bx, b[0], (draw - .8) * 5), b[1], '#597b78');
          } else {
            L(c, a[0], a[1], mix(a[0], b[0], draw), mix(a[1], b[1], draw), '#8b9b80');
          }
        }
      });
    }
    // During creation, the entire constellation becomes one luminous artifact.
    if (bloom > 0) {
      c.globalAlpha = bloom;
      R(c, 61, 47, 262, 2, '#345e65'); R(c, 61, 171, 262, 2, '#345e65');
      L(c, 59, 53, 59, 167, '#345e65'); L(c, 325, 53, 325, 167, '#345e65');
      [[61,47],[318,47],[61,167],[318,167]].forEach(q => { R(c,q[0],q[1],6,2,'#b9bd91'); R(c,q[0],q[1],2,6,'#b9bd91'); });
      if (video) {
        for (let i = 0; i < 31; i++) { R(c, 68 + i * 8, 51, 3, 2, '#657d73'); R(c, 68 + i * 8, 166, 3, 2, '#657d73'); }
      } else {
        R(c, 81, 176, 230, 2, '#577c75'); R(c, 89, 181, 214, 1, '#304f57');
        R(c, 184, 34, 16, 7, '#8caa92'); R(c, 188, 36, 8, 1, '#e1d4a4');
        L(c,192,41,192,49,'#849985');
      }
      c.globalAlpha = 1;
    }
    positions.forEach((p, i) => {
      const x = p[0], y = p[1];
      const grow = ease(((t - 2 / 3) / .25) * 1.45 - i * .09);
      if (grow < .10) {
        const miniature = 1 - arrange * .72;
        if (miniature > .30) token(c, x, y, mode, i, miniature);
        E(c, x, y, 4, 4, '#527a71'); star(c, x, y, sky.pale, 2);
        if (arrange < .7) {
          star(c, x - 14, y - 10, '#597f7b', 1); R(c, x + 15, y + 8, 1, 1, '#a1b098');
        }
      } else {
        const w = Math.round(mix(8, 68, grow)), h = Math.round(mix(7, 43, grow));
        R(c, x - w / 2 + 2, y - h / 2 + 3, w, h, '#07151f');
        R(c, x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2, '#517971');
        R(c, x - w / 2, y - h / 2, w, h, '#c8c79d');
        if (w > 20 && h > 16) {
          if (video) {
            picture(c, Math.round(x - w/2 + 3), Math.round(y - h/2 + 6), w - 6, h - 12, i, Math.sin(t * 14 + i) * 1.5);
            for (let j = 4; j < w - 4; j += 8) { R(c, x - w/2 + j, y - h/2 + 2, 3, 2, '#35545a'); R(c, x - w/2 + j, y + h/2 - 4, 3, 2, '#35545a'); }
          } else slide(c, x - w/2 + 2, y - h/2 + 2, w - 4, h - 4, i);
        }
        // The original star survives as a registration point on each new frame.
        star(c, x - w / 2, y - h / 2, '#eee2b7', 1);
      }
    });
    if (bloom > .9) {
      star(c, 333, 166, '#dbd6a7', 3); star(c, 52, 49, '#829c8b', 2);
      R(c, 176, 188, 32, 1, '#5d7e76'); star(c, 192, 188, '#e0d8a6', 2);
    }
    c.restore();
  }
  function gear(c, x, y, radius, angle, col) {
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5 + angle;
      R(c, x + Math.cos(a) * (radius - 1) - 2, y + Math.sin(a) * (radius - 1) - 2, 5, 5, col);
    }
    E(c, x, y, radius - 2, radius - 2, col); E(c, x, y, radius - 5, radius - 5, '#283e36');
    for (let i = 0; i < 4; i++) {
      const a = angle + i * Math.PI / 2;
      L(c, x, y, x + Math.cos(a) * (radius - 4), y + Math.sin(a) * (radius - 4), '#bda67b', 2);
    }
    E(c, x, y, 3, 3, '#d2b985'); R(c, x, y - 1, 1, 3, '#6c7053');
  }
  function machineBackground(c) {
    R(c, 0, 0, W, H, '#111f23');
    // Workshop wall: overlapping tile joints, tiny ceramic glints, inset shelf.
    for (let y = 10; y < 175; y += 24) {
      R(c, 8, y, 368, 1, '#1a2c2c');
      for (let x = (y % 48 ? 17 : 35); x < 380; x += 48) R(c, x, y, 1, 24, '#1a2c2c');
    }
    R(c, 20, 27, 24, 2, '#435449'); R(c, 20, 29, 3, 15, '#34493f');
    R(c, 28, 20, 2, 6, '#a58660'); R(c, 26, 18, 6, 3, '#526b56');
    // Plumbing and a little pressure vessel on the left.
    R(c, 20, 77, 9, 95, '#263d35'); R(c, 22, 80, 2, 87, '#6c7f60');
    R(c, 16, 92, 17, 3, '#a38359'); R(c, 16, 148, 17, 3, '#a38359');
    R(c, 14, 170, 34, 5, '#795f45'); R(c, 14, 171, 34, 1, '#b18c60');
    E(c, 24, 75, 7, 5, '#546d52'); R(c, 20, 69, 8, 3, '#947950');
    R(c, 8, 190, 368, 8, '#4d5141'); R(c, 8, 190, 368, 2, '#96906a');
    R(c, 0, 198, 384, 18, '#1a2929'); R(c, 17, 198, 350, 3, '#0b1b20');
    for (let i = 0; i < 18; i++) R(c, 17 + i * 20, 207 + i % 3, 9, 1, '#30423a');
    // A tiny sprout beside the finished work.
    R(c, 359, 171, 12, 15, '#805f45'); R(c, 357, 169, 16, 3, '#bc9367');
    L(c, 365, 169, 365, 151, '#6f946d');
    P(c, [[365,162],[357,156],[358,151],[364,155]], '#789d78');
    P(c, [[366,157],[372,148],[376,150],[371,156]], '#a1b28b');
  }
  function sortingMachine(c, rawT, mode, _kit) {
    c.save(); c.globalAlpha = 1;
    const t = Math.min(.95, Math.max(0, rawT));
    const video = mode === 'video', collect = ease(t * 3), sort = ease((t - 1/3) * 3);
    const output = ease((t - 2/3) / .27), motor = t * 9;
    machineBackground(c);
    // Rubber feet, cast frame, copper shoulders, and two inset service bays.
    R(c, 49, 184, 24, 6, '#0a181b'); R(c, 219, 184, 24, 6, '#0a181b');
    R(c, 39, 62, 214, 119, '#101d1e'); R(c, 43, 52, 206, 131, '#957754');
    R(c, 47, 48, 198, 135, '#c39b6d'); R(c, 47, 52, 198, 4, '#e1c190');
    R(c, 49, 57, 194, 122, '#596d51'); R(c, 52, 60, 188, 116, '#405b48');
    R(c, 47, 178, 198, 6, '#715d43'); R(c, 52, 180, 188, 1, '#bc986b');
    R(c, 50, 154, 83, 22, '#263b32'); R(c, 138, 154, 101, 22, '#263b32');
    // Hopper, visibly open at the top. Its sloped walls lead into the glass.
    P(c, [[54,30],[143,30],[128,55],[119,62],[80,62],[67,53]], '#896e4c');
    P(c, [[59,33],[138,33],[124,52],[115,57],[83,57],[72,49]], '#273b32');
    L(c, 55, 30, 142, 30, '#dbb98b', 2); L(c, 58, 33, 77, 57, '#c59a6b', 2);
    L(c, 140, 33, 122, 57, '#a7875c', 2); R(c, 78, 58, 44, 5, '#c49a68');
    // Pressure gauge and a restrained light tree.
    E(c, 173, 42, 15, 15, '#1a2d28'); E(c, 173, 42, 12, 12, '#ac8c60'); E(c, 173, 42, 9, 9, '#dfd2a7');
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (.85 + i * .22); R(c, 173 + Math.cos(a)*7, 42+Math.sin(a)*7, 1, 1, '#657258');
    }
    const needle = -2.4 + collect * 1.1 + sort * .4 + output * .8;
    L(c, 173, 42, 173 + Math.cos(needle)*6, 42 + Math.sin(needle)*6, '#875d47'); R(c,172,41,3,3,'#55694f');
    R(c, 207, 31, 22, 16, '#263c31'); R(c, 210, 28, 16, 3, '#9b8158');
    for (let i = 0; i < 3; i++) {
      const on = i === Math.min(2, Math.floor(t * 3));
      E(c, 212 + i * 6, 39, 2, 3, on ? '#d7d79b' : '#657a56');
      if (on) R(c, 212 + i * 6, 37, 1, 1, '#f0e8c3');
    }
    // Output elbow attaches to the chamber and leads to the receiving tray.
    R(c, 243, 110, 32, 23, '#141f1d'); R(c, 246, 113, 27, 17, '#a68155');
    R(c, 247, 116, 23, 11, '#233d33'); R(c, 250, 114, 18, 2, '#d1af7d');
    R(c, 256, 110, 4, 23, '#d0a574'); R(c, 257, 111, 1, 21, '#e0bf8a');
    R(c, 269, 99, 8, 63, '#8b7450'); R(c, 272, 102, 3, 58, '#d3b37f');
    R(c, 272, 163, 79, 9, '#304a3a'); R(c, 271, 163, 81, 3, '#b59a6b');
    R(c, 281, 172, 7, 18, '#53634b'); R(c, 336, 172, 7, 18, '#53634b');
    R(c, 280, 186, 65, 3, '#2b4034');
    // The chamber is deep enough to see the mechanism under the glass.
    R(c, 55, 65, 182, 87, '#b28d5e'); R(c, 58, 68, 176, 81, '#152e2d');
    R(c, 61, 71, 170, 75, '#1c3c36'); R(c, 62, 72, 167, 1, '#4c7160');
    for (let y = 78; y <= 139; y += 12) for (let x = 67; x <= 226; x += 12) R(c, x, y, 1, 1, '#355448');
    // Moving belt teeth and its four rollers remain below the ingredients.
    R(c, 63, 137, 164, 7, '#111f20'); R(c, 65, 137, 160, 1, '#8a9371');
    for (let i = 0; i < 22; i++) R(c, 66 + ((i * 7 + Math.floor(motor * 4)) % 156), 140, 3, 2, '#536d51');
    [70,119,168,218].forEach(x => { E(c,x,142,4,4,'#9a855a'); E(c,x,142,2,2,'#283c32'); });
    // Sorting rails extend into three lanes and two clear rows.
    const rail = sort;
    for (let i = 0; i < 3; i++) {
      R(c, 72 + i * 53, 132, 38 * rail, 2, '#68836a');
      R(c, 72 + i * 53, 104, 38 * rail, 1, '#68836a');
      if (rail > .3) { R(c, 73 + i*53, 101, 2, 4, '#b4b58a'); R(c, 106 + i*53, 129, 2, 4, '#b4b58a'); }
    }
    // Thought fragments fall through the hopper, then stop in a legible 3 x 2 order.
    const start = [[64,17],[101,14],[134,21],[82,40],[114,34],[93,59]];
    const loose = [[80,90],[120,121],[157,86],[201,111],[94,115],[177,120]];
    for (let i = 0; i < 6; i++) {
      const arrival = ease(clamp(t * 3 * 1.3 - i * .055));
      const gx = 90 + (i % 3) * 53, gy = 94 + Math.floor(i / 3) * 28;
      const wobble = Math.sin(t * 27 + i * 2) * 4 * (1 - sort) * arrival;
      let x = mix(mix(start[i][0], loose[i][0], arrival), gx, sort);
      let y = mix(mix(start[i][1], loose[i][1], arrival) + wobble, gy, sort);
      const transit = ease(((t - 2/3) / .26) * 1.6 - i * .13);
      if (transit < 1) {
        x = mix(x, 263, transit); y = mix(y, 121, transit);
        token(c, x, y, mode, i, 1 - transit * .65);
      }
      if (transit >= 1) { R(c, gx - 4, gy, 8, 1, '#6f9275'); star(c, gx, gy, '#aab885', 1); }
    }
    // A gantry carriage watches each row: no opaque beam obscures the sorting.
    const armX = mix(65, 211, sort);
    R(c, 65, 74, 160, 3, '#71886a'); R(c, 65, 77, 160, 1, '#122b29');
    R(c, armX, 73, 12, 6, '#c5ac7c'); R(c, armX + 4, 79, 3, 7, '#b59160');
    L(c, armX+5, 85, armX+1, 89, '#d3bd8c'); L(c,armX+6,85,armX+10,89,'#d3bd8c');
    // Glass: thin edge reflections and two small diagonal glints, never a flat veil.
    L(c, 59, 69, 59, 146, '#80a18b'); L(c, 60, 69, 232, 69, '#98b49a');
    L(c, 232, 71, 232, 147, '#3f6959'); R(c, 61, 147, 169, 1, '#597c66');
    L(c, 65, 83, 74, 74, '#597e6b'); L(c, 65, 89, 79, 75, '#416c5b');
    L(c, 215, 140, 224, 131, '#456e5b');
    // Exposed paired gears and flywheel. Their motion stops in the held final pose.
    gear(c, 70, 165, 10, motor, '#b99561'); gear(c, 91, 165, 9, -motor, '#8f9a6b');
    E(c, 119, 164, 8, 8, '#9a8357'); E(c,119,164,5,5,'#243c31');
    L(c,119,164,119+Math.cos(motor)*5,164+Math.sin(motor)*5,'#d0b584',2);
    R(c, 146, 160, 47, 9, '#132c28');
    for (let i = 0; i < 11; i++) R(c, 150+i*4, 162, 2, 5, i < 3+sort*4+output*4 ? '#a7ba80' : '#3e614b');
    E(c, 209, 165, 6, 6, '#ad885b'); E(c,209,165,3,3,'#314a38');
    E(c, 226, 165, 4, 4, output > .9 ? '#ddda9b' : '#71855c');
    [[49,60],[242,60],[49,174],[242,174]].forEach(q=>bolt(c,q[0],q[1]));
    // Empty recipient silhouettes anticipate the selected format from the start.
    if (video) {
      E(c,312,108,23,23,'#253b32'); E(c,312,108,20,20,'#142924');
      E(c,312,108,3,3,'#4a6750');
      for(let j=0;j<5;j++){const a=j*Math.PI*2/5;E(c,312+Math.cos(a)*12,108+Math.sin(a)*12,4,4,'#2d4839');}
    } else {
      R(c,289,114,56,36,'#263f32'); R(c,285,110,56,36,'#365540'); R(c,281,106,56,36,'#1b342c');
      R(c,287,112,29,2,'#42634b'); R(c,287,120,17,12,'#2f4d3a'); R(c,310,121,20,1,'#42634b');
    }
    // The object emerges gradually on its own tray; its two forms are unmistakable.
    if (output > 0) {
      if (video) {
        const reel = ease(output * 1.7);
        const cx = 312, cy = 105, rad = Math.round(24 * reel);
        if (rad > 2) {
          E(c,cx+2,cy+2,rad,rad,'#0b1c1d'); E(c,cx,cy,rad,rad,'#c8b47f'); E(c,cx,cy,rad-3,rad-3,'#8d9d75');
          for (let j=0;j<5;j++) {
            const a=j*Math.PI*2/5 + motor*.35;
            E(c,cx+Math.cos(a)*rad*.57,cy+Math.sin(a)*rad*.57,rad*.22,rad*.22,'#294839');
          }
          E(c,cx,cy,4,4,'#e0c995'); E(c,cx,cy,2,2,'#516746');
        }
        const width = Math.round(81 * ease(output * 1.18));
        R(c, 274, 132, width, 29, '#cdb984'); R(c,274,135,width,23,'#243e35');
        for (let j = 0; j < 3; j++) {
          const fw = Math.min(23, width - 3 - j*26);
          if (fw > 0) picture(c, 277+j*26,138,fw,17,j,Math.sin(motor+j));
        }
        for (let j=3;j<width-2;j+=7) { R(c,274+j,133,3,1,'#304b3b'); R(c,274+j,159,3,1,'#304b3b'); }
        L(c,333,109,344,132,'#baab7a',2); L(c,335,109,346,132,'#3b5742');
      } else {
        for (let j=2;j>=0;j--) {
          const emerge = ease(output*1.5-j*.18);
          if (emerge <= 0) continue;
          const x=mix(271,282+j*4,emerge), y=mix(137,107+j*6,emerge), w=Math.round(62*emerge), h=Math.round(39*emerge);
          R(c,x+2,y+2,w,h,'#112a26'); R(c,x,y,w,h,j===0?'#eed9ac':'#9ca986');
          if (w>23 && h>17) slide(c,x+2,y+2,w-4,h-4,j);
        }
        if (output>.85) {
          R(c,310,151,18,5,'#a68a5f'); R(c,313,150,12,5,'#cfb682'); R(c,316,151,6,1,'#f0dfb2');
        }
      }
      if (output > .94) { star(c, 350, 89, '#d7d9a0', 3); star(c, 280, 79, '#91ac80', 2); }
    }
    c.restore();
  }
  window.thinkingConcepts = window.thinkingConcepts || [];
  window.thinkingConcepts.push(
    {
      id: 3,
      title: 'The creative constellation',
      description: 'Ideas find their gravity in a midnight observatory. A precise star map connects the fragments, then blooms into a luminous storyboard or a branching deck of slides.',
      stages: ['Gather the sparks', 'Connect the story', 'Let the work shine'],
      draw: constellation
    },
    {
      id: 4,
      title: 'The sorting machine',
      description: 'A copper-and-green workshop turns loose ingredients into something ready to share. Watch the glass chamber sort each thought, then deliver a film reel or a tidy slide stack.',
      stages: ['Feed the imagination', 'Put ideas in order', 'Make something real'],
      draw: sortingMachine
    }
  );
})();
