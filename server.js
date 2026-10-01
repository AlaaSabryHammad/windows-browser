#!/usr/bin/env node
/* Tiny static file server — zero dependencies. Serves ./public on localhost. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function handler(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    urlPath = '/';
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: unknown paths get index.html
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, idx) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(idx);
      });
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function listen(port, attempt) {
  if (attempt > 10) { console.error('Could not find a free port.'); process.exit(1); }
  const srv = http.createServer(handler);
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`Port ${port} is busy, trying ${port + 1} ...`);
      listen(port + 1, attempt + 1);
    } else { throw e; }
  });
  srv.listen(port, () => {
    console.log('');
    console.log('  ┌──────────────────────────────────────────┐');
    console.log('  │   Windows 10 Web  —  running              │');
    console.log(`  │                                          │`);
    console.log(`  │   Open:  http://localhost:${port}           │`);
    console.log('  │   Stop:  Ctrl + C                        │');
    console.log('  └──────────────────────────────────────────┘');
  });
}

const argPort = parseInt(process.argv.slice(2).find(a => /^\d+$/.test(a)) || '', 10);
listen(argPort || parseInt(process.env.PORT || '3000', 10) || 3000, 0);
