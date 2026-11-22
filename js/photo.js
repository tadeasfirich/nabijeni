// Fotka palubní desky: zmenšení (ať telefon nezaplní stovky MB) a čas pořízení z EXIF.

const MAX_SIDE = 1400;
const QUALITY = 0.8;

// Čas pořízení: EXIF DateTimeOriginal → čas souboru (jen když je čerstvý) → teď.
export function photoTime(exifDate, lastModified) {
  const now = Date.now();
  if (exifDate && exifDate.getTime() < now + 3600000 && exifDate.getTime() > now - 400 * 86400000) return exifDate;
  if (lastModified && lastModified < now + 60000 && lastModified > now - 7 * 86400000) return new Date(lastModified);
  return new Date(now);
}

export async function preparePhoto(file) {
  const buf = await file.arrayBuffer();
  let exif = null;
  try { exif = exifDate(buf); } catch { exif = null; }
  const time = photoTime(exif, file.lastModified);
  const blob = await shrink(file);
  return { blob, time, fromExif: !!exif };
}

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* starší prohlížeč */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Fotku se nepodařilo otevřít.'));
    img.src = URL.createObjectURL(file);
  });
}

async function shrink(file) {
  const img = await loadImage(file);
  const w = img.width, h = img.height;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.round(w * k), ch = Math.round(h * k);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
  if (img.close) img.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', QUALITY));
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ---- EXIF (JPEG): DateTimeOriginal (0x9003), náhradně DateTime (0x0132)
export function exifDate(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
  let p = 2;
  while (p + 4 < v.byteLength) {
    const marker = v.getUint16(p);
    const len = v.getUint16(p + 2);
    if (marker === 0xFFE1 && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10);
    if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
    p += 2 + len;
  }
  return null;
}

function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le);
  const u32 = (o) => v.getUint32(t + o, le);
  const readIfd = (off) => {
    const n = u16(off);
    const tags = {};
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), valOff: e + 8 };
    }
    return tags;
  };
  const ascii = (tag) => {
    if (!tag || tag.type !== 2) return null;
    const off = tag.count > 4 ? u32(tag.valOff) : tag.valOff;
    let s = '';
    for (let i = 0; i < tag.count - 1; i++) s += String.fromCharCode(v.getUint8(t + off + i));
    return s;
  };
  const ifd0 = readIfd(u32(4));
  let str = null;
  if (ifd0[0x8769]) {
    const exif = readIfd(u32(ifd0[0x8769].valOff));
    str = ascii(exif[0x9003]) || ascii(exif[0x9004]);
  }
  str = str || ascii(ifd0[0x0132]);
  const m = str && str.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? null : d;
}
