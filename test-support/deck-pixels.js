// A scaled SVG edge can round to a slightly different colour in a composed iframe or after motion.
// Check dimensions and every pixel. Allow small colour rounding on at most one in a thousand pixels.
import assert from 'node:assert/strict';

export async function assertSameSlidePixels(page, actual, expected, message) {
  const result = await page.evaluate(async sources => {
    const [a, b] = await Promise.all(sources.map(async source => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + source;
      await image.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    }));
    let changed = 0, peak = 0;
    if (a.width === b.width && a.height === b.height) {
      for (let i = 0; i < a.data.length; i += 4) {
        const delta = Math.max(...[0, 1, 2, 3].map(c => Math.abs(a.data[i + c] - b.data[i + c])));
        if (delta) changed++;
        peak = Math.max(delta, peak);
      }
    }
    return { actual: [a.width, a.height], expected: [b.width, b.height], changed, peak };
  }, [actual, expected].map(buffer => buffer.toString('base64')));
  assert.deepEqual(result.actual, result.expected, message);
  assert.ok(result.peak <= 12 && result.changed <= result.actual[0] * result.actual[1] / 1000, `${message}: ${JSON.stringify(result)}`);
}
