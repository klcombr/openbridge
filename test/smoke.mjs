import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = join(HERE, '..', 'server', 'hub.mjs');

const TOKEN = 'a'.repeat(64);
const PIN = '4321';

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

function baseUrl(port) {
  return `http://127.0.0.1:${port}`;
}

function authHeaders() {
  return { 'x-openbridge-token': TOKEN, 'x-openbridge-pin': PIN };
}

function rawUpload(port, headers) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/upload', method: 'POST', headers },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', () => resolve(0));
    req.end();
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${baseUrl(port)}/`);
      if (res.status === 200) return true;
    } catch {
      /* retry */
    }
    await wait(100);
  }
  return false;
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'obtest-'));
  const home = join(tmp, 'home');
  const cfgDir = join(home, '.config', 'openbridge');
  mkdirSync(cfgDir, { recursive: true });
  const root = join(tmp, 'OpenBridge');
  mkdirSync(join(root, 'Send'), { recursive: true });
  mkdirSync(join(root, 'Receive'), { recursive: true });
  const port = 19000 + Math.floor(Math.random() * 500);
  writeFileSync(join(cfgDir, 'config.json'), JSON.stringify({ port, token: TOKEN, pin: PIN }));

  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const fakePlayerctl = join(bin, 'playerctl');
  writeFileSync(
    fakePlayerctl,
    [
      '#!/bin/sh',
      'case "$1" in',
      '  metadata) echo "Artista - Titulo" ;;',
      '  status) echo "Playing" ;;',
      '  volume) echo "0.42" ;;',
      '  *) exit 0 ;;',
      'esac',
      '',
    ].join('\n'),
  );
  chmodSync(fakePlayerctl, 0o755);

  const child = spawn(process.execPath, [HUB], {
    env: { ...process.env, HOME: home, OPENBRIDGE_ROOT: root, PATH: `${bin}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[hub] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[hub!] ${d}`));

  const up = await waitForServer(port);
  ok(up, 'servidor subiu');
  if (!up) {
    child.kill();
    process.exit(1);
  }
  const base = baseUrl(port);

  console.log('\n— auth —');
  let res = await fetch(`${base}/api/status`);
  ok(res.status === 401, 'sem auth → 401');
  res = await fetch(`${base}/api/status`, { headers: { 'x-openbridge-token': 'x'.repeat(64), 'x-openbridge-pin': PIN } });
  ok(res.status === 401, 'token errado → 401');
  res = await fetch(`${base}/api/status`, { headers: { ...authHeaders(), 'x-openbridge-pin': '9999' } });
  ok(res.status === 401, 'PIN errado → 401');
  res = await fetch(`${base}/api/status`, { headers: authHeaders() });
  ok(res.status === 200, 'auth correta → 200');

  console.log('\n— media (mock playerctl) —');
  const st = await res.json();
  ok(st.online === true, 'media online');
  ok(st.playing === true, 'media playing');
  ok(st.title === 'Artista - Titulo', 'media title');
  ok(st.volume === 42, 'media volume 42');
  res = await fetch(`${base}/api/media?cmd=next`, { headers: authHeaders() });
  ok(res.status === 200, 'media next → 200');
  res = await fetch(`${base}/api/media?cmd=evil`, { headers: authHeaders() });
  ok(res.status === 400, 'media cmd desconhecido → 400');

  console.log('\n— upload —');
  res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: { ...authHeaders(), 'x-openbridge-filename': 'foto.jpg' },
    body: Buffer.from('dados-da-foto'),
  });
  ok(res.status === 201, 'upload ok → 201');
  ok(existsSync(join(root, 'Receive', 'foto.jpg')), 'arquivo caiu em Receive/');
  res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: { ...authHeaders(), 'x-openbridge-filename': '../../etc/passwd' },
    body: Buffer.from('x'),
  });
  ok(res.status === 400, 'upload ../ → 400');
  res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: { ...authHeaders(), 'x-openbridge-filename': 'sub/dir.jpg' },
    body: Buffer.from('x'),
  });
  ok(res.status === 400, 'upload com / → 400');
  res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: { ...authHeaders(), 'x-openbridge-filename': 'foto.jpg' },
    body: Buffer.from('duplicado'),
  });
  ok(res.status === 409, 'upload duplicado → 409');
  const big = await rawUpload(port, {
    ...authHeaders(),
    'x-openbridge-filename': 'gigante.bin',
    'content-length': String(51 * 1024 * 1024),
  });
  ok(big === 413, 'upload > 50MB → 413');

  console.log('\n— download —');
  writeFileSync(join(root, 'Send', 'ok.txt'), 'conteudo-do-send');
  res = await fetch(`${base}/api/files`, { headers: authHeaders() });
  const listing = await res.json();
  ok(res.status === 200 && listing.files.some((f) => f.name === 'ok.txt'), 'lista Send/ tem ok.txt');
  res = await fetch(`${base}/api/files/ok.txt`, { headers: authHeaders() });
  ok(res.status === 200 && (await res.text()) === 'conteudo-do-send', 'download ok.txt conteúdo correto');
  res = await fetch(`${base}/api/files/%2E%2E%2Fconfig.json`, { headers: authHeaders() });
  ok(res.status !== 200, 'download ../ → bloqueado');
  res = await fetch(`${base}/api/files/config.json`, { headers: authHeaders() });
  ok(res.status === 404, 'download inexistente → 404');

  console.log('\n— rate limit (upload) —');
  let saw429 = false;
  let created = 0;
  for (let i = 0; i < 12; i++) {
    res = await fetch(`${base}/api/upload`, {
      method: 'POST',
      headers: { ...authHeaders(), 'x-openbridge-filename': `rl-${i}.txt` },
      body: Buffer.from('x'),
    });
    if (res.status === 201) created += 1;
    if (res.status === 429) saw429 = true;
  }
  ok(saw429, 'upload rate limit → 429');
  ok(created >= 5, `uploads criados >= 5 antes do 429 (${created})`);

  child.kill();
  console.log(`\nRESULTADO: ${passed} ok, ${failed} falha${failed === 1 ? '' : 's'}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke test quebrou:', err);
  process.exit(1);
});
