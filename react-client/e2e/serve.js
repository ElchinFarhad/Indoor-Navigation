/**
 * Minimal static server for the production build (with the single-page-app
 * fallback to index.html), used by the end-to-end test.
 *
 *   node e2e/serve.js [port]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.txt': 'text/plain',
};

/**
 * The security headers of the production web server (deploy/nginx.conf), so
 * that the tests run under the same Content-Security-Policy as the real site.
 */
function productionHeaders() {
  const conf = fs.readFileSync(path.resolve(__dirname, '../../deploy/nginx.conf'), 'utf8');
  const headers = {};
  for (const m of conf.matchAll(/^\s*add_header\s+([A-Za-z-]+)\s+"([^"]*)"\s+always;/gm)) headers[m[1]] = m[2];
  return headers;
}

function createServer(root, extraHeaders) {
  const extra = extraHeaders || {};
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.normalize(path.join(root, urlPath));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }, extra));
    fs.createReadStream(file).pipe(res);
  });
}

module.exports = { createServer, productionHeaders };

if (require.main === module) {
  const port = parseInt(process.argv[2] || '5000', 10);
  createServer(path.resolve(__dirname, '../build')).listen(port, () => {
    console.log(`Serving build/ on http://localhost:${port}`);
  });
}
