/**
 * Draws the Kaarobarly app icon, Android adaptive icon layers, splash image and favicon.
 * Run from apps/mobile:  node scripts/make-icons.cjs
 * The shapes match src/components/logo.tsx (a 100 x 100 grid).
 */
const path = require('path');
const Jimp = require('jimp-compact');

const OUT = path.resolve(__dirname, '../assets/images');
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BLUE = hex('#1463F3'), TEAL = hex('#0FA9B8'), GREEN = hex('#1DC87C'), NAVY = hex('#0B1B4D'), NAVY2 = hex('#0E2C72'), WHITE = [255, 255, 255];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// K: stem, rising arm (ends in the arrow), leg
const SEGS = [[[18, 14], [18, 84]], [[18, 56], [78, 16]], [[36, 44], [56, 84]]];
const ARROW = [[88.8, 8.8], [82.2, 24.0], [72.2, 9.05]];
const BARS = [[64, 62], [74, 48], [84, 36]];
const HALF = 7;

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function inTriangle(px, py, [a, b, c]) {
  const s = (p, q) => (px - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (py - q[1]);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
/** Is the point (logo grid units) inside the mark? */
function inMark(x, y) {
  for (const [a, b] of SEGS) if (distToSegment(x, y, a, b) <= HALF) return true;
  if (inTriangle(x, y, ARROW)) return true;
  for (const [bx, by] of BARS) if (x >= bx && x <= bx + 7 && y >= by && y <= 84) return true;
  return false;
}
const markColor = (x) => (x < 55 ? mix(BLUE, TEAL, Math.max(0, (x - 10) / 45)) : mix(TEAL, GREEN, Math.min(1, (x - 55) / 35)));

/**
 * @param size   output width and height in pixels
 * @param scale  mark size as a fraction of the canvas
 * @param bg     'navy' (gradient), 'solid', or null for transparent
 * @param mono   draw the mark in white
 * @param round  corner radius fraction for the background (0 = square)
 */
async function draw(file, { size, scale, bg, mono = false, round = 0, markOnly = true }) {
  const data = Buffer.alloc(size * size * 4);
  const unit = (size * scale) / 100; // pixels per grid unit
  const off = (size - 92 * unit) / 2 - 3 * unit; // the mark spans x 3..95, y 4..87 on the grid
  const offY = (size - 83 * unit) / 2 - 4 * unit;
  const SS = 3;
  const r = round * size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (inMark((px + (sx + 0.5) / SS - off) / unit, (py + (sy + 0.5) / SS - offY) / unit)) cover++;
      cover /= SS * SS;
      let base = [0, 0, 0], alpha = 0;
      if (bg) {
        // rounded-corner mask
        const cx = Math.min(px, size - 1 - px), cy = Math.min(py, size - 1 - py);
        const inside = r === 0 || cx >= r || cy >= r || Math.hypot(r - cx, r - cy) <= r;
        if (inside) {
          base = bg === 'navy' ? mix(NAVY, NAVY2, (px + py) / (2 * size)) : NAVY;
          alpha = 1;
        }
      }
      const ink = mono ? WHITE : markColor((px + 0.5 - off) / unit);
      const outA = cover + alpha * (1 - cover);
      const rgb = outA === 0 ? [0, 0, 0] : ink.map((v, i) => (v * cover + base[i] * alpha * (1 - cover)) / outA);
      const o = (py * size + px) * 4;
      data[o] = Math.round(rgb[0]);
      data[o + 1] = Math.round(rgb[1]);
      data[o + 2] = Math.round(rgb[2]);
      data[o + 3] = Math.round(outA * 255);
    }
  }
  const img = await new Promise((resolve, reject) => new Jimp({ data, width: size, height: size }, (err, image) => (err ? reject(err) : resolve(image))));
  await img.writeAsync(path.join(OUT, file));
  console.log('wrote', file);
}

(async () => {
  await draw('icon.png', { size: 1024, scale: 0.62, bg: 'navy' });
  await draw('android-icon-foreground.png', { size: 1024, scale: 0.44, bg: null });
  await draw('android-icon-background.png', { size: 1024, scale: 0.0001, bg: 'navy' });
  await draw('android-icon-monochrome.png', { size: 1024, scale: 0.44, bg: null, mono: true });
  await draw('splash-icon.png', { size: 512, scale: 0.9, bg: null });
  await draw('favicon.png', { size: 96, scale: 0.66, bg: 'navy', round: 0.22 });
})();
