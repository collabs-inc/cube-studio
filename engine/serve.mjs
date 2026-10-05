import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { resolveIn } from './paths.mjs';
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.svg':'image/svg+xml', '.json':'application/json' };
// Serves a project root; /engine/, /brand/ and /node_modules/ fall back to the app's copies (see paths.mjs).
export function serve(root, port = 0) {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = resolveIn(root, u === '/' ? '/reel.html' : u);
      if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(port, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}
