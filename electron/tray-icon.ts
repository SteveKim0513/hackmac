import zlib from 'node:zlib';
import { nativeImage, type NativeImage } from 'electron';

// A menu-bar "template" icon (black glyph + alpha, macOS auto-inverts for
// light/dark) drawn and PNG-encoded entirely at runtime — no binary asset to
// ship or regenerate when the design changes. Glyph: a 2x2 grid of tiles,
// echoing the "store of services" concept.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** Encodes a grayscale+alpha bitmap (2 bytes/px: gray, alpha) as a PNG. */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 4; // color type: grayscale + alpha
  const stride = width * 2;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    raw.set(pixels.subarray(y * stride, y * stride + stride), rowStart + 1);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawGlyph(size: number): Buffer {
  const scale = size / 16;
  const pixels = new Uint8Array(size * size * 2); // defaults to transparent black
  const inTile = (v: number) => (v >= 2 && v <= 6.5) || (v >= 9.5 && v <= 14);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const r = py / scale;
      const c = px / scale;
      if (inTile(r) && inTile(c)) {
        const idx = (py * size + px) * 2;
        pixels[idx + 1] = 255; // opaque black (gray channel already 0)
      }
    }
  }
  return encodePng(size, size, pixels);
}

export function createTrayIcon(): NativeImage {
  const image = nativeImage.createFromBuffer(drawGlyph(18));
  image.setTemplateImage(true);
  return image;
}
