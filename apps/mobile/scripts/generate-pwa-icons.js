// Generates the PWA icons into public/. Run: npm run icons -w @ftth/mobile
//
// No image library on purpose: the icon is a flat teal field with a white
// "signal over a fibre line" mark, which is simple enough to rasterise by hand
// and write as PNG with node's built-in zlib. Adding sharp (a native binary) to
// the workspace for one-off icons was not worth it.
//
// Commit the PNGs it writes — the build does not run this.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEAL = [0x0f, 0x76, 0x6e];
const WHITE = [0xff, 0xff, 0xff];
const OUT = path.join(__dirname, '..', 'public');

// Coverage of a shape edge at signed distance d (pixels, negative = inside),
// giving a one-pixel antialiased edge.
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d));

// Signed distance helpers, all in the icon's 0..1 coordinate space scaled by `s`.
const ringDist = (x, y, cx, cy, r, half) => Math.abs(Math.hypot(x - cx, y - cy) - r) - half;

function render(size, { safe }) {
  // `safe` is the fraction of the canvas the mark may occupy. Maskable icons get
  // cropped to a circle or squircle by the OS; the spec's safe zone is the
  // central 80%, so the mark is drawn smaller there than on the plain icon.
  const s = size * safe;
  const ox = (size - s) / 2;
  const oy = (size - s) / 2;
  const cx = ox + s * 0.5;
  const cy = oy + s * 0.62;
  const stroke = s * 0.055;

  const px = Buffer.alloc(size * size * 3);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = i + 0.5;
      const y = j + 0.5;
      let a = 0;

      // Three signal arcs above the node, clipped to the upper half-plane.
      for (const r of [0.2, 0.34, 0.48]) {
        if (y <= cy) a = Math.max(a, cover(ringDist(x, y, cx, cy, s * r, stroke / 2)));
      }
      // The node itself.
      a = Math.max(a, cover(Math.hypot(x - cx, y - cy) - s * 0.075));
      // The fibre line running out beneath it.
      if (y >= cy) a = Math.max(a, cover(Math.max(Math.abs(x - cx) - stroke / 2, y - (oy + s * 0.92))));

      const o = (j * size + i) * 3;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(TEAL[c] * (1 - a) + WHITE[c] * a);
    }
  }
  return px;
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour, no alpha — the icons are full-bleed
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let j = 0; j < size; j++) {
    rows[j * (size * 3 + 1)] = 0; // filter: none
    rgb.copy(rows, j * (size * 3 + 1) + 1, j * size * 3, (j + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icons = [
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  ['icon-maskable-512.png', 512, 0.6],
  // iOS ignores the manifest's icons and wants this one, full-bleed (it rounds
  // the corners itself).
  ['apple-touch-icon.png', 180, 0.8],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size, safe] of icons) {
  fs.writeFileSync(path.join(OUT, name), png(size, render(size, { safe })));
  console.log(`wrote public/${name}`);
}
