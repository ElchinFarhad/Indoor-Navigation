/**
 * Generates a printable QR marker (SVG) for every marker of a venue.
 *
 *   node scripts/generate-markers.js [--venue demo/engineering-building] [--base http://localhost:3000] [--format scanner|at] [--out ../QRCodeImages]
 *
 * --venue is the store folder below venues-src/ (<retailer>/<store>).
 *
 * --format scanner  payload "<base>/qrScanner/<id>" - the format of the original
 *                   markers (local0.pdf ...). Default.
 * --format at       payload "<base>/?at=<id>" - opened with the phone's own
 *                   camera app this lands on the destination list with the
 *                   start position already known.
 *
 * The in-app scanner only reads the id, so the host in the payload matters
 * only for people who scan a marker outside the app.
 *
 * Each sheet shows which edge has to point to the top of the map: all floor
 * markers must be laid down with the same orientation, because the app derives
 * the direction the user is facing from the way the code appears in the image.
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const base = option('base', 'http://localhost:3000').replace(/\/$/, '');
const format = option('format', 'scanner');
const outDir = path.resolve(__dirname, option('out', '../../QRCodeImages'));
const graph = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../venues-src', option('venue', 'demo/engineering-building'), 'map.json'), 'utf8'));
const floors = (graph.meta && graph.meta.floors) || [];

function payload(id) {
  return format === 'at' ? `${base}/?at=${id}` : `${base}/qrScanner/${id}`;
}

function markerSvg(node) {
  const qr = QRCode.create(payload(node.id), { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 4;
  const total = n + quiet * 2;
  const scale = 1000 / total; // the code itself is 1000 units wide
  let cells = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(y, x)) {
        cells += `M${((x + quiet) * scale).toFixed(2)} ${((y + quiet) * scale).toFixed(2)}h${scale.toFixed(2)}v${scale.toFixed(2)}h-${scale.toFixed(2)}z`;
      }
    }
  }
  const floor = floors.find((f) => f.id === (node.floor || 0));
  const title = node.label || (node.type === 'room' ? `Room ${node.name}` : `Marker ${node.name}`);
  const caption = `${title} · id ${node.id}${floor ? ` · ${floor.name}` : ''}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1180" width="200mm" height="236mm">
  <rect width="1000" height="1180" fill="#fff"/>
  <text x="500" y="62" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#525E75">▲ this edge towards the top of the map ▲</text>
  <g transform="translate(0 90)">
    <path d="${cells}" fill="#000"/>
  </g>
  <text x="500" y="1140" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="bold" fill="#1c2330">${caption}</text>
</svg>
`;
}

fs.mkdirSync(outDir, { recursive: true });
let count = 0;
for (const node of graph.nodes) {
  if (node.qr === false) continue;
  const file = path.join(outDir, `marker-${String(node.id).padStart(2, '0')}-${node.name}.svg`);
  fs.writeFileSync(file, markerSvg(node));
  count++;
}
console.log(`Wrote ${count} markers to ${outDir} (payload: ${payload('<id>')})`);
