import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(__dirname, '../build');
fs.mkdirSync(buildDir, { recursive: true });

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function drawBellIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.44;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = (x - cx) / radius;
      const ny = (y - cy) / radius;

      // Rounded square background
      const rx = Math.abs(x - cx) / (size * 0.46);
      const ry = Math.abs(y - cy) / (size * 0.46);
      const corner = Math.max(0, rx - 0.68) ** 2 + Math.max(0, ry - 0.68) ** 2;

      if (rx <= 1 && ry <= 1 && corner <= 0.32 ** 2) {
        // Blue gradient background
        const t = y / size;
        let r = Math.round(29 + (37 - 29) * t);
        let g = Math.round(78 + (99 - 78) * t);
        let b = Math.round(216 + (235 - 216) * t);
        let a = 255;

        // White/gold bell silhouette
        const inTopKnob = nx * nx + (ny + 0.56) ** 2 <= 0.1 * 0.1;
        const bellBodyHalfW = ny >= -0.48 && ny <= 0.28 ? 0.22 + (ny + 0.48) * 0.36 : -1;
        const inDome = nx * nx + (ny + 0.2) ** 2 <= 0.28 * 0.28 && ny <= -0.15;
        const inBody = Math.abs(nx) <= bellBodyHalfW;
        const inFlaredRim = ny > 0.25 && ny <= 0.38 && Math.abs(nx) <= 0.54;
        const inClapper = nx * nx + (ny - 0.48) ** 2 <= 0.13 * 0.13;

        if (inTopKnob || inDome || inBody || inFlaredRim) {
          r = 255;
          g = 255;
          b = 255;
        } else if (inClapper) {
          r = 250;
          g = 204;
          b = 21;
        }

        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = a;
      }
    }
  }
  return encodePng(size, size, rgba);
}

const png256 = drawBellIcon(256);
fs.writeFileSync(path.join(buildDir, 'icon.png'), png256);

// Wrap 256x256 PNG inside standard ICO container
const icoHeader = Buffer.alloc(6 + 16);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // type = icon
icoHeader.writeUInt16LE(1, 4); // count = 1
icoHeader[6] = 0; // width 256 -> 0
icoHeader[7] = 0; // height 256 -> 0
icoHeader[8] = 0;
icoHeader[9] = 0;
icoHeader.writeUInt16LE(1, 10); // planes
icoHeader.writeUInt16LE(32, 12); // bpp
icoHeader.writeUInt32LE(png256.length, 14); // bytes
icoHeader.writeUInt32LE(22, 18); // offset

fs.writeFileSync(path.join(buildDir, 'icon.ico'), Buffer.concat([icoHeader, png256]));
console.log('Generated build/icon.png and build/icon.ico');
