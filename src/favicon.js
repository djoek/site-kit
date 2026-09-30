// site-kit favicon: from public/favicon.svg, write favicon.ico (16+32), apple-touch-icon.png (180),
// icon-192.png, icon-512.png and site.webmanifest into public/.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Convert oklch(L C h [/ a]) to an sRGB colour string. The rasteriser (librsvg) does not
 * understand oklch(), so only the copy that gets rasterised is converted; the source keeps OKLCH.
 * Path: OKLCH -> OKLab -> LMS (cubed) -> linear sRGB -> gamma-encoded sRGB.
 */
export function oklchToRgb(text) {
  const match = text.match(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)/i);
  if (!match) return text;
  const L = Number(match[1]) / (match[2] ? 100 : 1);
  const C = Number(match[3]);
  const h = (Number(match[4]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const encode = (x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  const [r, g, bl] = linear.map(encode);
  const alpha = match[5] === undefined ? 1 : Number(match[5]) / (match[6] ? 100 : 1);
  return alpha === 1 ? `rgb(${r}, ${g}, ${bl})` : `rgba(${r}, ${g}, ${bl}, ${alpha})`;
}

/** An .ico file is a small directory header followed by PNG images. */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

export async function favicon({ root, site, log = console.log }) {
  const publicDir = path.join(root, 'public');
  const source = path.join(publicDir, 'favicon.svg');
  if (!existsSync(source)) throw new Error('public/favicon.svg not found; it is the source for all icons');
  const svg = Buffer.from(readFileSync(source, 'utf8').replace(/oklch\([^)]*\)/gi, (colour) => oklchToRgb(colour)));
  const png = (size) => sharp(svg, { density: Math.max(72, (72 * size) / 32) }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

  writeFileSync(path.join(publicDir, 'favicon.ico'), ico([{ size: 16, data: await png(16) }, { size: 32, data: await png(32) }]));
  writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), await png(180));
  writeFileSync(path.join(publicDir, 'icon-192.png'), await png(192));
  writeFileSync(path.join(publicDir, 'icon-512.png'), await png(512));
  const manifest = {
    name: site.name,
    short_name: site.name,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    display: 'standalone',
  };
  writeFileSync(path.join(publicDir, 'site.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);
  log('wrote public/favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, site.webmanifest');
}
