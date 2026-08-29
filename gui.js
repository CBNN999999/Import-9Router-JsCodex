#!/usr/bin/env node
/**
 * Giao diện web cục bộ cho ChatGPT/Codex Bulk Importer.
 * Chỉ lắng nghe 127.0.0.1, không cần npm install.
 *
 *   node gui.js [--port 3848]
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const {
  DEFAULT_DB_PATH,
  DEFAULT_BASE_URL,
  expandUploads,
  parseUploads,
  bulkImport,
} = require('./importer-core');

// 32 MiB cap for the JSON request body. ZIPs are sent base64-encoded by the
// browser, so the effective ZIP size limit is ~24 MiB. ZIPs larger than that
// don't fit through the GUI; users should use the CLI instead.
const MAX_BODY = 32 * 1024 * 1024;
const MAX_ZIP_BYTES_DECODED = Math.floor(MAX_BODY * 0.75);

function parseArgs() {
  const a = process.argv.slice(2);
  let port = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--port' && a[i + 1]) port = parseInt(a[++i], 10) || 0;
  }
  return { port };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (ch) => {
      total += ch.length;
      if (total > MAX_BODY) {
        reject(
          new Error(
            `Payload quá lớn (>${Math.floor(MAX_BODY / 1024 / 1024)} MiB). ` +
              `Với ZIP lớn, dùng CLI: node import.js <file>.zip`
          )
        );
        req.destroy();
        return;
      }
      chunks.push(ch);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (_) {
    /* ignore */
  }
}

const { port: requestedPort } = parseArgs();
const guiHtmlPath = path.join(__dirname, 'gui.html');
let guiHtml = '';
try {
  guiHtml = fs.readFileSync(guiHtmlPath, 'utf8');
} catch (e) {
  console.error('Không đọc được gui.html:', e.message);
  process.exit(1);
}

// Inject default db path placeholder so the field shows the actual resolved
// path without revealing it as a value.
const dbPathDisplay = DEFAULT_DB_PATH.replace(/\\/g, '\\\\').replace(/"/g, '&quot;');
const dbBackend = /\.sqlite$/i.test(DEFAULT_DB_PATH) ? 'sqlite' : 'json';
guiHtml = guiHtml.replace(
  'placeholder="~/.9router/db/data.sqlite"',
  `placeholder="${dbPathDisplay}" data-default="${dbPathDisplay}" data-backend="${dbBackend}"`
);

// Reject obviously oversized ZIP uploads up front so the user gets a clear
// error message instead of a generic "payload too large".
function validateZipSizes(uploads) {
  for (const u of uploads || []) {
    if (u && u.zip && typeof u.zip === 'string') {
      // Each base64 char encodes 6 bits; estimate decoded size.
      const decodedBytes = Math.floor((u.zip.length * 3) / 4);
      if (decodedBytes > MAX_ZIP_BYTES_DECODED) {
        return {
          ok: false,
          error:
            `ZIP "${u.name}" (~${(decodedBytes / 1024 / 1024).toFixed(1)} MiB) ` +
            `quá lớn cho GUI. Dùng CLI: node import.js "${u.name}"`,
        };
      }
    }
  }
  return { ok: true };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(guiHtml);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/parse') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      const uploads = Array.isArray(body.files)
        ? body.files.filter(
            (f) =>
              f &&
              typeof f.name === 'string' &&
              (typeof f.text === 'string' || typeof f.zip === 'string')
          )
        : [];
      const sizeCheck = validateZipSizes(uploads);
      if (!sizeCheck.ok) {
        sendJson(res, 200, { ok: false, error: sizeCheck.error });
        return;
      }
      const rows = await parseUploads(uploads);
      sendJson(res, 200, { ok: true, rows });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/import') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      const inputUploads = Array.isArray(body.files)
        ? body.files.filter(
            (f) =>
              f &&
              typeof f.name === 'string' &&
              (typeof f.text === 'string' || typeof f.zip === 'string')
          )
        : [];
      const sizeCheck = validateZipSizes(inputUploads);
      if (!sizeCheck.ok) {
        sendJson(res, 200, { ok: false, message: sizeCheck.error, parsed: [] });
        return;
      }

      // Server-side expand: ZIP → N JSON uploads.
      const { uploads, errors: expandErrors } = expandUploads(inputUploads);

      if (uploads.length === 0) {
        sendJson(res, 200, {
          ok: false,
          message:
            expandErrors.length > 0
              ? `Không có file JSON hợp lệ (${expandErrors.length} file lỗi)`
              : 'Không có file JSON nào',
          parsed: expandErrors.map((e) => ({ name: e.name, error: e.error })),
        });
        return;
      }

      // Stage uploads to a temp folder so we can reuse bulkImport (which reads
      // from disk). Keeps a single code path between CLI and GUI.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-codex-'));
      const stagedFiles = [];
      try {
        for (let i = 0; i < uploads.length; i++) {
          const u = uploads[i];
          const safe = (u.name || `upload-${i}.json`).replace(/[^\w.\-]+/g, '_');
          const p = path.join(tmpDir, `${i}_${safe}`);
          fs.writeFileSync(p, u.text, 'utf8');
          stagedFiles.push({ path: p, originalName: u.name });
        }

        const result = await bulkImport({
          inputs: stagedFiles.map((s) => s.path),
          dbPath: typeof body.dbPath === 'string' && body.dbPath ? body.dbPath : undefined,
          baseUrl: typeof body.baseUrl === 'string' && body.baseUrl ? body.baseUrl : DEFAULT_BASE_URL,
          forceStop: !!body.forceStop,
          noRestart: !!body.noRestart,
          dryRun: false,
        });

        // Rewrite "file" field in parsed[] back to original upload names so the
        // UI shows the user's filenames, not staging paths. Also strip any
        // residual accessToken just in case (parseUploads already does this,
        // but bulkImport-derived rows are independent).
        const byPath = new Map(stagedFiles.map((s) => [s.path, s.originalName]));
        const parsed = (result.parsed || []).map((p) => {
          const cleaned = { ...p };
          if (cleaned.source) {
            const s = { ...cleaned.source };
            delete s.accessToken;
            cleaned.source = s;
          }
          if (cleaned.entry) {
            // The entry contains tokens — the UI never needs them.
            const { accessToken, refreshToken, ...rest } = cleaned.entry;
            cleaned.entry = rest;
          }
          cleaned.name = byPath.get(p.file) || (p.file ? path.basename(p.file) : '');
          return cleaned;
        });
        // Surface ZIP expand errors (corrupt zip etc.) at the top of the
        // parsed list so the UI shows them too.
        const allParsed = [
          ...expandErrors.map((e) => ({ name: e.name, error: e.error })),
          ...parsed,
        ];

        sendJson(res, 200, { ...result, parsed: allParsed });
      } finally {
        // Clean up staged files no matter what.
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) { /* ignore */ }
      }
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message || String(e) });
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.on('error', (e) => {
  console.error(e.message || e);
  process.exit(1);
});

server.listen(requestedPort || 0, '127.0.0.1', () => {
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : requestedPort;
  const url = `http://127.0.0.1:${port}/`;
  console.log(`9router ChatGPT/Codex Importer — GUI: ${url}`);
  console.log('Nhấn Ctrl+C để thoát.');
  openBrowser(url);
});
