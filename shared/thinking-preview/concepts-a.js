/* Storybench thinking studies: classic script, deterministic and scrub-safe. */
(() => {
  'use strict';

  const clamp = n => Math.max(0, Math.min(1, n));
  const ease = n => { n = clamp(n); return n * n * (3 - 2 * n); };
  const mix = (a, b, n) => a + (b - a) * n;
  const range = (t, a, b) => ease((t - a) / (b - a));
  const ink = '#17201e';
  function rect(c, x, y, w, h, color) {
    if (w <= 0 || h <= 0) return;
    c.fillStyle = color;
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function line(c, x, y, xx, yy, color, width = 1) {
    x = Math.round(x); y = Math.round(y); xx = Math.round(xx); yy = Math.round(yy);
    const dx = Math.abs(xx - x), sx = x < xx ? 1 : -1;
    const dy = -Math.abs(yy - y), sy = y < yy ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      rect(c, x, y, width, width, color);
      if (x === xx && y === yy) break;
      const e = 2 * err;
      if (e >= dy) { err += dy; x += sx; }
      if (e <= dx) { err += dx; y += sy; }
    }
  }
  function star(c, x, y, color, size = 2) {
    rect(c, x - size, y, size * 2 + 1, 1, color);
    rect(c, x, y - size, 1, size * 2 + 1, color);
    rect(c, x, y, 1, 1, '#f5e9cd');
  }
  function alpha(c, amount, draw) {
    c.save(); c.globalAlpha *= clamp(amount); draw(); c.restore();
  }
  function bench(c, x, y, s, color, light) {
    rect(c, x, y, 13 * s, 2 * s, light);
    rect(c, x, y + 3 * s, 13 * s, 2 * s, color);
    rect(c, x - s, y + 6 * s, 15 * s, 2 * s, light);
    rect(c, x + s, y + 8 * s, 2 * s, 4 * s, color);
    rect(c, x + 10 * s, y + 8 * s, 2 * s, 4 * s, color);
  }
  // Every little video frame contains a miniature illustrated story world.
  function landscape(c, x, y, w, h, variant, movement, dreamy) {
    const sky = dreamy ? '#a5a5bc' : '#a8b7a4';
    const far = dreamy ? '#878fa0' : '#799080';
    const near = dreamy ? '#667d7d' : '#4e6e61';
    rect(c, x, y, w, h, sky);
    rect(c, x, y, w, 2, dreamy ? '#c4bfce' : '#c8c8a6');
    const sunx = x + w * .73, suny = y + h * .18;
    rect(c, sunx + 1, suny, 5, 7, '#eed9a8');
    rect(c, sunx, suny + 1, 7, 5, '#eed9a8');
    const wind = Math.round(movement);
    rect(c, x + w * .14 + wind, y + h * .21, w * .23, 2, '#dfdfc7');
    rect(c, x + w * .19 + wind, y + h * .21 - 2, w * .12, 2, '#dfdfc7');
    rect(c, x, y + h * .53, w, h * .47, far);
    rect(c, x + w * .13, y + h * .43, w * .31, h * .13, far);
    rect(c, x + w * .22, y + h * .35, w * .16, h * .13, far);
    rect(c, x + w * .54, y + h * .65, w * .46, h * .35, near);
    rect(c, x + w * .7, y + h * .55, w * .3, h * .2, near);
    rect(c, x, y + h - 5, w, 5, near);
    if (w >= 45) {
      // A small tree, path, and the recurring creative bench signature.
      rect(c, x + 8, y + h - 19, 2, 15, '#455e56');
      rect(c, x + 3, y + h - 24, 12, 8, '#526e60');
      rect(c, x + 5, y + h - 28, 8, 5, '#607d68');
      rect(c, x + 3, y + h - 22, 4, 2, '#83957a');
      rect(c, x + w * .39, y + h - 6, w * .25, 2, '#b3b394');
      rect(c, x + w * .34, y + h - 4, w * .35, 2, '#b3b394');
      bench(c, x + w * .48, y + h - 17, 1, '#4c493d', '#c6ab7d');
      if (variant === 1) {
        rect(c, x + w * .43, y + h - 13, 3, 6, '#b7876e');
        rect(c, x + w * .43, y + h - 16, 3, 3, '#e2c39b');
      }
    } else {
      rect(c, x + w * .2, y + h * .68, w * .33, 2, '#c9b990');
      rect(c, x + w * .25, y + h * .68 + 2, 2, 4, '#6b6050');
      rect(c, x + w * .45, y + h * .68 + 2, 2, 4, '#6b6050');
    }
  }
  function slide(c, x, y, w, h, variant, tint) {
    rect(c, x, y, w, h, '#ede3c8');
    rect(c, x, y, 3, h, tint);
    rect(c, x + 6, y + 5, w * .48, 2, '#53665e');
    rect(c, x + 6, y + 9, w * .3, 1, '#a4aa92');
    if (variant % 3 === 0) {
      rect(c, x + 6, y + 15, w * .4, h - 21, tint);
      if (h > 35) bench(c, x + 9, y + h - 21, 1, '#4f6458', '#e3d8b3');
      for (let j = 0; j < 3; j++) rect(c, x + w * .55, y + 17 + j * 5, w * (.3 - j * .04), 1, '#a2aa91');
    } else if (variant % 3 === 1) {
      const base = y + h - 7;
      line(c, x + 7, base, x + w - 7, base, '#b9b99c');
      for (let j = 0; j < 3; j++) {
        const bh = (h - 20) * (.35 + j * .28);
        rect(c, x + 9 + j * (w - 20) / 3, base - bh, Math.max(3, w / 7), bh, j === 2 ? '#657e70' : tint);
      }
    } else {
      for (let j = 0; j < 3; j++) {
        rect(c, x + 7, y + 16 + j * (h - 21) / 3, 3, 3, tint);
        rect(c, x + 14, y + 17 + j * (h - 21) / 3, w - 22 - (j % 2) * 5, 2, '#9ca58e');
      }
    }
    rect(c, x + w - 8, y + h - 4, 4, 1, tint);
  }
  function tile(c, x, y, w, h, mode, tint, variant) {
    x = Math.round(x); y = Math.round(y);
    rect(c, x + 2, y + 3, w, h, '#151e20');
    rect(c, x, y, w, h, '#ddd1b5');
    if (mode === 'video') {
      rect(c, x + 1, y + 1, w - 2, h - 2, '#344442');
      landscape(c, x + 3, y + 5, w - 6, h - 10, variant, 0, tint === '#b2a2c3');
      for (let j = 4; j < w - 3; j += 6) {
        rect(c, x + j, y + 2, 2, 1, '#c8c4a9');
        rect(c, x + j, y + h - 3, 2, 1, '#c8c4a9');
      }
    } else slide(c, x + 1, y + 1, w - 2, h - 2, variant, tint);
    rect(c, x, y, w, 1, '#ede1c0');
  }

  function deskRoom(c) {
    rect(c, 0, 0, 384, 216, '#18231f');
    rect(c, 0, 0, 384, 133, '#202b25');
    // Quiet paneling, shelf and framed thumbnail studies.
    for (let x = 18; x < 384; x += 42) {
      rect(c, x, 0, 1, 132, '#2a3229');
      rect(c, x + 2, 0, 1, 132, '#1c2721');
    }
    rect(c, 245, 19, 100, 3, '#484936');
    rect(c, 248, 22, 96, 4, '#111e1b');
    for (let i = 0; i < 4; i++) {
      const x = 252 + i * 22;
      rect(c, x, 3 + i % 2 * 3, 17, 16 - i % 2 * 3, '#605b40');
      rect(c, x + 2, 5 + i % 2 * 3, 13, 12 - i % 2 * 3, '#88917a');
      rect(c, x + 4, 12, 9, 5, '#415b4c');
      rect(c, x + 10, 8, 2, 2, '#b9ad7a');
    }
    rect(c, 20, 33, 44, 44, '#101c19');
    rect(c, 22, 34, 40, 40, '#6c6041');
    rect(c, 25, 37, 34, 34, '#b7ac83');
    rect(c, 28, 40, 28, 28, '#627c68');
    bench(c, 35, 49, 1, '#394f43', '#d7c291');
    // Stepped pools of honey light: no blur, gradients or antialiasing.
    for (let j = 0; j < 13; j++) {
      rect(c, 73 - j * 2, 55 + j * 6, 38 + j * 10, 6, j < 4 ? '#333c2b' : '#38402c');
      for (let i = 0; i < 5; i++) rect(c, 71 - j * 2 + i * 3, 55 + j * 6 + i % 3, 1, 1, '#475034');
    }
    // Substantial wooden desktop, with grain, seams, bevel and brass fixings.
    rect(c, 0, 132, 384, 69, '#5f5038');
    rect(c, 0, 132, 384, 3, '#9a7d4f');
    rect(c, 0, 137, 384, 1, '#76633f');
    for (let j = 0; j < 5; j++) {
      const y = 143 + j * 12;
      rect(c, 0, y, 384, 1, '#443e2d');
      rect(c, 0, y + 1, 384, 1, '#71603e');
      for (let i = 0; i < 8; i++) {
        const x = (i * 53 + j * 29) % 384;
        rect(c, x, y + 5, 9 + (i * 13) % 28, 1, '#6b583b');
        rect(c, x + 5, y + 7, 8 + i % 9, 1, '#514731');
      }
    }
    rect(c, 0, 201, 384, 3, '#ae8953');
    rect(c, 0, 204, 384, 12, '#342f24');
    rect(c, 0, 209, 384, 1, '#51422d');
    for (const x of [9, 374]) { rect(c, x, 205, 3, 3, '#8e7447'); rect(c, x + 1, 206, 1, 1, '#342e21'); }
    // Inlaid leather working mat keeps the central storytelling silhouette clear.
    rect(c, 91, 144, 225, 43, '#403e2c');
    rect(c, 94, 142, 219, 43, '#34483c');
    rect(c, 97, 145, 213, 37, '#3c5041');
    for (let x = 99; x < 309; x += 6) rect(c, x, 180, 2, 1, '#718065');
    // Articulated brass lamp.
    rect(c, 27, 160, 42, 5, '#282c23');
    rect(c, 31, 156, 34, 5, '#aa8b51');
    rect(c, 37, 153, 22, 3, '#c1a263');
    line(c, 47, 153, 38, 102, '#282e23', 7);
    line(c, 49, 152, 40, 102, '#b49a5d', 3);
    line(c, 40, 102, 78, 58, '#292f23', 7);
    line(c, 42, 102, 80, 58, '#c1a66a', 3);
    rect(c, 37, 100, 9, 9, '#b19a60'); rect(c, 40, 103, 3, 3, '#514f33');
    rect(c, 76, 48, 17, 5, '#64765a');
    rect(c, 70, 53, 31, 6, '#7e8b63');
    rect(c, 64, 59, 43, 6, '#8f9b6b');
    rect(c, 62, 65, 47, 4, '#cfbd7b');
    rect(c, 69, 69, 33, 3, '#f1d99b');
    rect(c, 76, 55, 3, 6, '#b1b27a');
    // Cup, pencil crock, tools, and a dog-eared paper stack.
    rect(c, 325, 151, 30, 5, '#403c2e');
    rect(c, 328, 130, 20, 23, '#b8ad86');
    rect(c, 328, 129, 20, 4, '#e3d0a3');
    rect(c, 331, 130, 14, 2, '#514436');
    rect(c, 348, 134, 7, 13, '#b8ad86'); rect(c, 348, 137, 4, 7, '#5f5038');
    rect(c, 331, 136, 3, 13, '#d7c79e');
    rect(c, 348, 99, 17, 26, '#686c4b');
    rect(c, 350, 101, 2, 22, '#9e9f6c');
    for (let i = 0; i < 4; i++) {
      const x = 350 + i * 4, top = 78 + i % 3 * 5;
      rect(c, x, top, 2, 22, ['#c2975b', '#8f9a73', '#af8067', '#d0bb87'][i]);
      rect(c, x, top - 3, 2, 3, '#d6bf90'); rect(c, x, top - 4, 1, 1, '#212c23');
    }
    rect(c, 14, 181, 49, 13, '#393a2b');
    rect(c, 12, 178, 46, 13, '#b6aa82'); rect(c, 15, 176, 46, 12, '#d3c49a');
    rect(c, 19, 180, 25, 1, '#9d9e7a'); rect(c, 19, 183, 32, 1, '#b3ac84');
    line(c, 60, 187, 84, 172, '#292d22', 3); line(c, 60, 186, 82, 172, '#c99c5c', 2);
    rect(c, 321, 175, 40, 5, '#a7976a');
    for (let i = 0; i < 10; i++) rect(c, 324 + i * 4, 175, 1, i % 2 ? 2 : 3, '#5d5b3e');
  }

  function desk(c, rawT, mode) {
    c.save(); c.globalAlpha = 1;
    const t = Math.min(rawT, .95), collect = range(t, 0, 1 / 3);
    const arrange = range(t, 1 / 3, 2 / 3), create = range(t, 2 / 3, .94);
    deskRoom(c);
    // The aligned paper rail grows underneath the actual fragments.
    alpha(c, arrange * (1 - create), () => {
      rect(c, 111, 84, 189, 2, '#929273');
      for (let i = 0; i < 6; i++) rect(c, 123 + i * 31, 80, 2, 7, '#b5ab7b');
    });
    const start = [[126, 21], [190, 9], [261, 29], [113, 67], [209, 51], [287, 68]];
    const pile = [[147, 100], [183, 91], [224, 104], [130, 130], [192, 127], [252, 127]];
    const colors = ['#a7b18a', '#c7a46f', '#abbd9a', '#b99779', '#a6b694', '#c5b184'];
    alpha(c, 1 - range(create, .08, .83), () => {
      for (let i = 0; i < 6; i++) {
        const q = range(collect, i * .07, .65 + i * .07);
        const ax = 111 + (i % 3) * 65, ay = 91 + Math.floor(i / 3) * 43;
        let x = mix(start[i][0], pile[i][0], q), y = mix(start[i][1], pile[i][1], q);
        x = mix(x, ax, arrange); y = mix(y, ay, arrange);
        x = mix(x, 119 + (i % 3) * 63, create); y = mix(y, 104, create);
        const w = mix(31, 54, arrange), h = mix(25, 35, arrange);
        alpha(c, .45 + .55 * range(collect, i * .045, .2 + i * .045), () => tile(c, x, y, w, h, mode, colors[i], i));
        if (collect < .85) {
          alpha(c, (1 - q) * .7, () => {
            rect(c, x + 10, y - 11, 1, 5, '#b7aa76');
            rect(c, x + 20, y - 17, 1, 3, '#7c8761');
          });
        }
      }
    });
    // The contact sheet becomes a continuous film, or three finished, fanned slides.
    alpha(c, range(create, .03, .65), () => {
      if (mode === 'video') {
        const y = mix(119, 100, create);
        rect(c, 101, y + 5, 210, 66, '#1b2924');
        rect(c, 104, y, 204, 63, '#b3a57f');
        rect(c, 106, y + 2, 200, 59, '#2b3831');
        for (let i = 0; i < 3; i++) landscape(c, 111 + i * 64, y + 10, 60, 43, i, Math.sin(rawT * 16 + i) * 1.5, false);
        for (let i = 0; i < 25; i++) {
          rect(c, 109 + i * 8, y + 4, 4, 3, '#cabd97');
          rect(c, 109 + i * 8, y + 56, 4, 3, '#cabd97');
        }
        // Trimmed film tails and a little playback tab.
        rect(c, 97, y + 9, 7, 45, '#39463a'); rect(c, 308, y + 9, 6, 45, '#39463a');
        rect(c, 190, y + 63, 33, 10, '#25372e');
        rect(c, 204, y + 66, 2, 5, '#d5c393'); rect(c, 206, y + 67, 2, 3, '#d5c393'); rect(c, 208, y + 68, 1, 1, '#d5c393');
      } else {
        for (let i = 0; i < 3; i++) {
          const x = mix(166, 115 + i * 49, create), y = mix(109, 108 - i * 13, create);
          rect(c, x + 3, y + 5, 86, 66, '#24352c');
          rect(c, x, y, 86, 66, '#b8ac86');
          slide(c, x + 2, y + 2, 82, 62, i, ['#9dab84', '#b6b98b', '#93ad92'][i]);
          rect(c, x + 2, y + 2, 82, 1, '#fff0ce');
        }
      }
    });
    alpha(c, range(create, .55, 1), () => {
      star(c, 301, 76, '#d8c78e', 3); star(c, 113, 100, '#9eb58b', 2);
      rect(c, 183, 188, 41, 1, '#927c50');
    });
    c.restore();
  }

  // Layered, stepped cloud silhouette; all corners remain square pixels.
  function cloudBody(c, x, y, color) {
    const strips = [[66,0,59,6],[48,6,95,6],[42,12,112,7],[26,19,145,7],
      [17,26,169,7],[9,33,190,8],[0,41,210,14],[5,55,206,12],
      [14,67,187,8],[31,75,155,6],[49,81,118,5]];
    for (const [dx,dy,w,h] of strips) rect(c, x + dx, y + dy, w, h, color);
    rect(c, x + 148, y + 13, 27, 9, color);
    rect(c, x + 159, y + 22, 31, 12, color);
    rect(c, x + 18, y + 21, 32, 10, color);
  }
  function cloudScene(c, t, mode, create) {
    rect(c, 0, 0, 384, 216, '#1b1c30');
    rect(c, 12, 14, 360, 186, '#202238');
    rect(c, 20, 21, 344, 172, '#24263c');
    rect(c, 36, 34, 313, 149, '#292b42');
    // Sparse fixed star field and tiny horizon islands give the cloud a setting.
    for (let i = 0; i < 52; i++) {
      const x = 18 + (i * 67) % 347, y = 18 + (i * 47) % 177;
      if (x > 75 && x < 310 && y > 51 && y < 167) continue;
      rect(c, x, y, 1, i % 8 === 0 ? 2 : 1, i % 4 ? '#51516b' : '#8f8ca1');
    }
    for (const [x,y,s] of [[42,59,2],[323,37,3],[347,129,2],[66,146,2],[284,181,2],[117,29,1]]) star(c, x, y, '#9697ad', s);
    rect(c, 30, 179, 58, 2, '#3b4154'); rect(c, 39, 175, 36, 4, '#3b4154');
    rect(c, 300, 169, 49, 2, '#414459'); rect(c, 310, 165, 28, 4, '#414459');
    // Crescent and its pixel halo.
    rect(c, 326, 64, 17, 23, '#494960'); rect(c, 323, 69, 23, 13, '#494960');
    rect(c, 329, 65, 12, 20, '#c1b9c4'); rect(c, 326, 69, 18, 12, '#c1b9c4');
    rect(c, 334, 63, 11, 17, '#292b42'); rect(c, 338, 68, 9, 13, '#292b42');
    const bob = mode === 'presentation' ? Math.sin(Math.min(t, .95) * 10) * (1 - create) : Math.sin(t * 10) * 1.1;
    const y = 67 + Math.round(bob);
    cloudBody(c, 82, y + 11, '#31374b');
    cloudBody(c, 85, y + 5, '#60617b');
    cloudBody(c, 84, y, '#9190aa');
    cloudBody(c, 82, y - 5, '#b3afc3');
    // Sculpted cloud lobes, shadow steps, top rim, and pale interior.
    rect(c, 111, y + 25, 161, 35, '#c4c0ce');
    rect(c, 131, y + 13, 112, 42, '#c4c0ce');
    rect(c, 149, y + 2, 56, 14, '#d5cddd');
    rect(c, 133, y + 7, 19, 5, '#d5cddd');
    rect(c, 111, y + 20, 25, 4, '#ded5df');
    rect(c, 102, y + 27, 17, 4, '#d5cddd');
    rect(c, 92, y + 37, 9, 11, '#d5cddd');
    rect(c, 234, y + 10, 22, 4, '#dbd3df');
    rect(c, 248, y + 17, 15, 5, '#d1cad9');
    rect(c, 264, y + 29, 18, 4, '#d1cad9');
    rect(c, 278, y + 39, 10, 8, '#d1cad9');
    rect(c, 105, y + 61, 29, 5, '#a5a6bb');
    rect(c, 132, y + 69, 95, 5, '#a5a6bb');
    rect(c, 223, y + 62, 48, 5, '#a5a6bb');
    rect(c, 143, y + 75, 55, 3, '#d0c7d9');
    // Floating thought-bubble tail and grounded shadow.
    rect(c, 113, 164, 17, 9, '#777e94'); rect(c, 116, 161, 11, 3, '#b3afc3');
    rect(c, 101, 179, 9, 6, '#7d8296'); rect(c, 103, 177, 5, 2, '#b3afc3');
    rect(c, 137, 190, 112, 3, '#1b2031'); rect(c, 151, 188, 85, 2, '#1d2234');
  }

  function cloud(c, rawT, mode) {
    c.save(); c.globalAlpha = 1;
    const t = mode === 'presentation' ? Math.min(rawT, .95) : rawT;
    const collect = range(t, 0, 1 / 3), arrange = range(t, 1 / 3, 2 / 3);
    const create = range(t, 2 / 3, .94);
    cloudScene(c, t, mode, create);
    const starts = [[48,38],[140,16],[269,21],[310,88],[46,111]];
    const nests = [[121,83],[161,72],[204,80],[238,100],[158,115]];
    const colors = ['#b2a2c3', '#aabca1', '#c7b5a4', '#acb7c4', '#b5bfa3'];
    // Five separate ingredients visibly thread into one reading order.
    alpha(c, arrange * (1 - create), () => {
      line(c, 103, 110, 281, 110, '#777d91');
      for (let i = 0; i < 4; i++) {
        rect(c, 124 + i * 39, 108, 3, 5, '#7a8191');
        rect(c, 127 + i * 39, 109, 2, 3, '#7a8191');
      }
    });
    alpha(c, 1 - range(create, .05, .8), () => {
      for (let i = 0; i < 5; i++) {
        const q = range(collect, i * .06, .65 + i * .06);
        let x = mix(starts[i][0], nests[i][0], q);
        let y = mix(starts[i][1], nests[i][1], q) - Math.sin(q * Math.PI) * 9;
        x = mix(x, 96 + i * 39, arrange); y = mix(y, 96, arrange);
        x = mix(x, 153 + i * 8, create); y = mix(y, 92, create);
        // Delicate stepped trails are strongest while ideas are still in flight.
        alpha(c, (1 - q) * .65, () => {
          for (let j = 0; j < 3; j++) rect(c, x - 6 - j * 4, y - 5 - j * 3, 2, 2, colors[i]);
        });
        tile(c, x, y, 31, 28, mode, colors[i], i);
        alpha(c, arrange, () => {
          for (let j = 0; j <= i; j++) rect(c, x + 4 + j * 4, y + 33, 2, 2, '#707e83');
        });
      }
    });
    alpha(c, range(create, .03, .65), () => {
      if (mode === 'video') {
        const w = mix(88, 150, create), h = mix(57, 92, create);
        const x = Math.round(192 - w / 2), y = Math.round(109 - h / 2);
        rect(c, x + 4, y + 6, w, h, '#6e718b');
        rect(c, x - 3, y + 7, 3, h - 14, '#e3d6d4');
        rect(c, x + w, y + 7, 3, h - 14, '#e3d6d4');
        rect(c, x, y, w, h, '#ede0d2');
        rect(c, x + 3, y + 3, w - 6, h - 6, '#434b60');
        landscape(c, x + 7, y + 12, w - 14, h - 24, 1, Math.sin(rawT * 13) * 2, true);
        for (let i = 0; i < Math.floor((w - 10) / 9); i++) {
          rect(c, x + 7 + i * 9, y + 5, 4, 3, '#c6c1ce');
          rect(c, x + 7 + i * 9, y + h - 8, 4, 3, '#c6c1ce');
        }
        // Small film ribbon emerging below the hero scene.
        rect(c, 160, y + h + 3, 64, 6, '#7b8295');
        for (let i = 0; i < 7; i++) rect(c, 164 + i * 8, y + h + 5, 4, 1, '#c4becd');
      } else {
        // Back slides separate and the front becomes an authored title composition.
        for (let i = 0; i < 3; i++) {
          const x = mix(155, 119 + i * 15, create);
          const y = mix(87, 63 + i * 13, create);
          const w = mix(78, 117, create), h = mix(51, 72, create);
          rect(c, x + 3, y + 5, w, h, '#797b92');
          rect(c, x, y, w, h, ['#9a9aaf','#c3bfce','#e8dfd1'][i]);
          slide(c, x + 3, y + 3, w - 6, h - 6, i === 2 ? 0 : i + 1, colors[i]);
        }
        // A quiet three-card thumbnail index makes the output read as a deck.
        for (let i = 0; i < 3; i++) {
          rect(c, 173 + i * 14, 168, 10, 6, i === 2 ? '#e8ddc9' : '#8e94a4');
          rect(c, 175 + i * 14, 170, 6, 1, '#616d7d');
        }
      }
    });
    alpha(c, range(create, .45, .95), () => {
      star(c, 105, 73, '#e5d9c8', 4); star(c, 284, 144, '#bfcdb6', 3);
      star(c, 278, 60, '#b9b2ca', 2);
      rect(c, 96, 64, 2, 2, '#a6bea9'); rect(c, 294, 151, 2, 2, '#bfb3c9');
    });
    c.restore();
  }

  window.thinkingConcepts = window.thinkingConcepts || [];
  window.thinkingConcepts.push(
    {
      id: 1,
      title: 'The idea desk',
      description: 'A honey-lit creative workbench: stray thoughts become a carefully ordered storyboard, then a finished film or a fan of presentation slides.',
      stages: ['Gather at the desk', 'Lay out the story', 'Make something worth sharing'],
      draw(ctx, t, mode, kit) { desk(ctx, t, mode); }
    },
    {
      id: 2,
      title: 'The thought cloud',
      description: 'Ideas drift into a luminous lavender cloud, find their reading order, and emerge as a tiny living scene or a composed presentation deck.',
      stages: ['Catch the ideas', 'Thread them together', 'Let the story emerge'],
      draw(ctx, t, mode, kit) { cloud(ctx, t, mode); }
    }
  );
})();
