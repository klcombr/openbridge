import { spawn } from 'node:child_process';
import { createReadStream, promises as fsp } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const MAX_UPLOAD = 50 * 1024 * 1024;

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function sanitizeName(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 255) return null;
  if (/[\\/\u0000-\u001f\u007f]/.test(raw)) return null;
  const name = raw.trim();
  if (!name || name === '.' || name === '..' || name.includes('..')) return null;
  return name;
}

function sendDir(root) {
  return join(root, 'Send');
}

function receiveDir(root) {
  return join(root, 'Receive');
}

export async function listSend(root) {
  const dir = sendDir(root);
  await fsp.mkdir(dir, { recursive: true });
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const st = await fsp.stat(join(dir, e.name));
    out.push({ name: e.name, size: st.size, modified: st.mtimeMs });
  }
  out.sort((a, b) => b.modified - a.modified);
  return out;
}

export function resolveDownload(root, name) {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return null;
  }
  const sendRoot = resolve(sendDir(root));
  const file = resolve(join(sendRoot, name));
  if (file !== sendRoot && !file.startsWith(sendRoot + sep)) return null;
  return file;
}

export async function saveUpload(root, name, buf) {
  const dir = receiveDir(root);
  await fsp.mkdir(dir, { recursive: true });
  const target = join(dir, name);
  await fsp.writeFile(target, buf, { flag: 'wx' });
  return target;
}

export function notifyUpload(name, size) {
  const child = spawn('notify-send', ['OpenBridge', `Arquivo recebido: ${name} (${fmtSize(size)})`], {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', () => {});
  child.unref();
}

export function createReadStreamSafe(file) {
  return createReadStream(file);
}
