import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as auth from './auth.mjs';
import { loadConfig, rootDir } from './config.mjs';
import * as files from './files.mjs';
import * as media from './media.mjs';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const WWW = join(HERE, '..', 'www');

const cfg = loadConfig();
const root = rootDir();

function log(req, status, extra) {
  const ip = auth.clientIp(req);
  const detail = extra ? ` ${extra}` : '';
  console.log(`[openbridge] ${new Date().toISOString()} ${req.method} ${req.url} ${status}${detail}`);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(obj));
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length']);
    if (!Number.isInteger(len) || len <= 0 || len > max) {
      reject(new Error(len > max ? 'payload too large' : 'missing or invalid Content-Length'));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        req.destroy();
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const STATIC = {
  '/': { file: join(WWW, 'index.html'), type: 'text/html; charset=utf-8' },
  '/manifest.webmanifest': { file: join(WWW, 'manifest.webmanifest'), type: 'application/manifest+json; charset=utf-8' },
  '/icon.svg': { file: join(WWW, 'icon.svg'), type: 'image/svg+xml' },
};

function handleStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  const entry = STATIC[url.pathname];
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  if (!existsSync(entry.file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('arquivo ausente');
    return;
  }
  const st = statSync(entry.file);
  res.writeHead(200, {
    'Content-Type': entry.type,
    'Content-Length': st.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': url.pathname === '/' ? 'no-cache' : 'max-age=3600',
  });
  createReadStream(entry.file).pipe(res);
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const cfg = loadConfig();

  if (auth.checkRateLimited(req, cfg, 30)) {
    log(req, 429);
    sendJson(res, 429, { error: 'muitas requisições' });
    return;
  }
  if (!auth.checkAuth(req, cfg)) {
    const limited = auth.limitAuthFailures(req);
    if (limited) {
      log(req, 429);
      sendJson(res, 429, { error: 'muitas tentativas' });
      return;
    }
    log(req, 401);
    sendJson(res, 401, { error: 'token ou PIN inválido' });
    return;
  }

  if (path === '/api/status') {
    const st = await media.status();
    log(req, 200);
    sendJson(res, 200, st);
    return;
  }

  if (path === '/api/media') {
    const cmd = url.searchParams.get('cmd') || '';
    const result = await media.command(cmd);
    log(req, result.ok ? 200 : 400, cmd);
    sendJson(res, result.ok ? 200 : 400, result.ok ? { ok: true } : { error: result.error || 'comando desconhecido' });
    return;
  }

  if (path === '/api/files') {
    try {
      const list = await files.listSend(root);
      log(req, 200, `${list.length} itens`);
      sendJson(res, 200, { files: list });
    } catch (err) {
      log(req, 500);
      sendJson(res, 500, { error: 'falha ao listar' });
    }
    return;
  }

  if (path.startsWith('/api/files/')) {
    let name;
    try {
      name = decodeURIComponent(path.slice('/api/files/'.length));
    } catch {
      name = '';
    }
    const file = files.resolveDownload(root, name);
    if (!file || !existsSync(file)) {
      log(req, 404);
      sendJson(res, 404, { error: 'arquivo não encontrado' });
      return;
    }
    const st = statSync(file);
    const ext = extname(file);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(res);
    log(req, 200, name);
    return;
  }

  if (path === '/api/upload') {
    if (auth.rateLimit(`${auth.clientIp(req)}|upload`, 10, 60_000)) {
      log(req, 429);
      sendJson(res, 429, { error: 'muitas requisições' });
      return;
    }
    const rawName = req.headers['x-openbridge-filename'];
    const name = files.sanitizeName(rawName);
    if (!name) {
      log(req, 400, 'nome inválido');
      sendJson(res, 400, { error: 'nome de arquivo inválido' });
      return;
    }
    try {
      const buf = await readBody(req, files.MAX_UPLOAD);
      await files.saveUpload(root, name, buf);
      files.notifyUpload(name, buf.length);
      log(req, 201, `${name} (${buf.length} bytes)`);
      sendJson(res, 201, { ok: true, name });
    } catch (err) {
      const msg = String(err && err.message).toLowerCase();
      const status = msg.includes('too large') ? 413 : msg.includes('exist') ? 409 : 400;
      log(req, status, msg.includes('exist') ? 'duplicado' : '');
      sendJson(res, status, { error: status === 409 ? 'arquivo já existe' : status === 413 ? 'arquivo muito grande' : 'upload inválido' });
    }
    return;
  }

  log(req, 404);
  sendJson(res, 404, { error: 'rota não encontrada' });
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'GET' || req.method === 'POST') handleApi(req, res);
      else {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
      }
      return;
    }
    if (req.method === 'GET') {
      handleStatic(req, res);
      return;
    }
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
  } catch (err) {
    console.error('[openbridge] erro no handler:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Error');
    }
  }
});

const PORT = Number(process.env.PORT) || cfg.port;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[openbridge] ouvindo em http://0.0.0.0:${PORT} (storage: ${root})`);
  console.log('[openbridge] use "openbridge pair" para ver IP/token/PIN (nunca logados aqui)');
});
