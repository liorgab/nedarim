/**
 * מייצר את סמל היישום (`build/icon.ico`) מקוד, בלי תלות בכלי גרפיקה ובלי
 * קובץ בינארי שמישהו צריך לתחזק ביד. הסמל הוא האות נ' לבנה על רקע בצבע
 * הראשי של הערכה – מספיק כדי לזהות את היישום בשורת המשימות ובתפריט התחל.
 *
 * הרצה:  node tools/icon/make-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// צבעי הערכה (src/renderer/src/theme.ts): כחול עמוק על לבן.
const BG = [21, 62, 117];
const FG = [255, 255, 255];

/** ציור האות נ' כשלושה מלבנים ביחידות 0..1 (מימין לשמאל, כמו האות עצמה). */
const STROKES = [
  { x: 0.46, y: 0.24, w: 0.30, h: 0.13 }, // התג הקטן בראש
  { x: 0.63, y: 0.24, w: 0.13, h: 0.52 }, // הרגל הימנית
  { x: 0.24, y: 0.63, w: 0.52, h: 0.13 }, // הבסיס
];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** קידוד PNG מינימלי (RGBA, ללא פילטרים) – מספיק לסמל גאומטרי. */
function png(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const radius = size * 0.18;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;

      // פינות מעוגלות: מחוץ לרדיוס בפינה – שקוף.
      const cx = Math.min(x, size - 1 - x);
      const cy = Math.min(y, size - 1 - y);
      if (cx < radius && cy < radius) {
        const d = Math.hypot(radius - cx, radius - cy);
        if (d > radius) continue;
      }

      const inStroke = STROKES.some(
        (s) =>
          x >= s.x * size && x < (s.x + s.w) * size && y >= s.y * size && y < (s.y + s.h) * size,
      );
      const color = inStroke ? FG : BG;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
  return png(size, px);
}

const images = SIZES.map((size) => ({ size, data: render(size) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + images.length * 16;
const entries = [];
for (const img of images) {
  const e = Buffer.alloc(16);
  e[0] = img.size >= 256 ? 0 : img.size;
  e[1] = img.size >= 256 ? 0 : img.size;
  e[4] = 1; // color planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(img.data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.data.length;
  entries.push(e);
}

const ico = Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
mkdirSync(join(ROOT, 'build'), { recursive: true });
writeFileSync(join(ROOT, 'build', 'icon.ico'), ico);
writeFileSync(join(ROOT, 'build', 'icon.png'), images[images.length - 1].data);
console.log(`build/icon.ico (${SIZES.join(', ')}) – ${ico.length} bytes`);
