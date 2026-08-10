import { randomBytes, randomInt } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(process.env.HOME || '.', '.config', 'openbridge');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const DEFAULT_ROOT = join(process.env.HOME || '.', 'OpenBridge');

function randomPin() {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

export function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
}

export function loadConfig() {
  let cfg = null;
  if (existsSync(CONFIG_PATH)) {
    try {
      cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      cfg = null;
    }
  }
  if (!cfg || typeof cfg !== 'object') cfg = {};
  if (process.env.OPENBRIDGE_TOKEN && process.env.OPENBRIDGE_TOKEN.length >= 16) cfg.token = process.env.OPENBRIDGE_TOKEN;
  if (typeof cfg.token !== 'string' || cfg.token.length < 16) cfg.token = randomBytes(16).toString('hex');
  if (process.env.OPENBRIDGE_PIN && /^\d{4}$/.test(process.env.OPENBRIDGE_PIN)) cfg.pin = process.env.OPENBRIDGE_PIN;
  if (!/^\d{4}$/.test(cfg.pin)) cfg.pin = randomPin();
  if (process.env.OPENBRIDGE_PORT) {
    const p = Number(process.env.OPENBRIDGE_PORT);
    if (Number.isInteger(p) && p > 0 && p < 65536) cfg.port = p;
  }
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) cfg.port = 18788;
  saveConfig(cfg);
  return cfg;
}

export function rotatePin(cfg) {
  cfg.pin = randomPin();
  saveConfig(cfg);
  return cfg.pin;
}

export function rootDir() {
  return process.env.OPENBRIDGE_ROOT || DEFAULT_ROOT;
}

export function networkIp() {
  for (const ifs of Object.values(networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}
