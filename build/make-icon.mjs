import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

// Renders the HackMac app icon: a dark rounded-square "terminal" tile with a
// ">_" prompt glyph, the same visual language as electron/tray-icon.ts
// (menu-bar glyph) but full color and baked-in rounded corners, since macOS
// does not auto-round custom .icns art for non-App-Store apps.
//
// Regenerate after a design tweak with:
//   node build/make-icon.mjs build/icon.iconset
//   iconutil -c icns build/icon.iconset -o build/icon.icns
//   rm -rf build/icon.iconset

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** Encodes an RGBA bitmap (4 bytes/px) as a PNG. */
function encodePngRGBA(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    raw.set(pixels.subarray(y * stride, y * stride + stride), rowStart + 1);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Rounded-rect coverage in [0,1] normalized space, centered box with margin.
function roundedRectCoverage(x, y, margin, radius) {
  const lo = margin;
  const hi = 1 - margin;
  const cx = Math.min(Math.max(x, lo + radius), hi - radius);
  const cy = Math.min(Math.max(y, lo + radius), hi - radius);
  if (x >= lo + radius && x <= hi - radius) {
    return y >= lo && y <= hi ? 1 : 0;
  }
  if (y >= lo + radius && y <= hi - radius) {
    return x >= lo && x <= hi ? 1 : 0;
  }
  const d = Math.hypot(x - cx, y - cy);
  return d <= radius ? 1 : 0;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function renderIcon(size) {
  const SS = 4; // supersample factor for anti-aliasing
  const hi = size * SS;
  const pixels = new Uint8Array(size * size * 4);

  // Terminal chevron ">" as two thick diagonal bars meeting at a point,
  // plus a short underscore cursor bar: the classic ">_" shell prompt.
  const chevTip = [0.56, 0.5];
  const chevTop = [0.22, 0.24];
  const chevBottom = [0.22, 0.76];
  const barThickness = 0.11;
  const cursor = { x0: 0.62, x1: 0.82, y0: 0.68, y1: 0.79 };

  const bgMargin = 0.045;
  const bgRadius = 0.22;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgCov = 0;
      let glyphCov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          bgCov += roundedRectCoverage(x, y, bgMargin, bgRadius);
          const dChev = Math.min(
            distToSegment(x, y, chevTop[0], chevTop[1], chevTip[0], chevTip[1]),
            distToSegment(x, y, chevTip[0], chevTip[1], chevBottom[0], chevBottom[1]),
          );
          const inChev = dChev <= barThickness / 2;
          const inCursor = x >= cursor.x0 && x <= cursor.x1 && y >= cursor.y0 && y <= cursor.y1;
          if (inChev || inCursor) glyphCov += 1;
        }
      }
      bgCov /= SS * SS;
      glyphCov /= SS * SS;

      // Background: subtle diagonal gradient, dark charcoal.
      const t = (px / size + py / size) / 2;
      const bgR = lerp(0x14, 0x08, t);
      const bgG = lerp(0x16, 0x08, t);
      const bgB = lerp(0x1c, 0x0b, t);

      // Glyph: terminal green.
      const glR = 0x35;
      const glG = 0xe3;
      const glB = 0xa1;

      const r = lerp(bgR, glR, glyphCov);
      const g = lerp(bgG, glG, glyphCov);
      const b = lerp(bgB, glB, glyphCov);
      const a = bgCov * 255;

      const idx = (py * size + px) * 4;
      pixels[idx] = Math.round(r);
      pixels[idx + 1] = Math.round(g);
      pixels[idx + 2] = Math.round(b);
      pixels[idx + 3] = Math.round(a);
    }
  }
  return encodePngRGBA(size, size, pixels);
}

const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

for (const [name, size] of targets) {
  fs.writeFileSync(path.join(outDir, name), renderIcon(size));
  console.log(`wrote ${name} (${size}x${size})`);
}

// Standalone PNG for dev-mode dock icon (app.dock.setIcon).
fs.writeFileSync(path.join(path.dirname(outDir), 'icon.png'), renderIcon(512));
console.log('wrote icon.png (512x512)');
