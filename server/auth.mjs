import { timingSafeEqual } from 'node:crypto';

export const TOKEN_HEADER = 'x-openbridge-token';
export const PIN_HEADER = 'x-openbridge-pin';

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function clientIp(req) {
  return (req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

export function checkAuth(req, cfg) {
  const token = req.headers[TOKEN_HEADER];
  const pin = req.headers[PIN_HEADER];
  if (typeof token !== 'string' || typeof pin !== 'string') return false;
  if (!/^\d{4}$/.test(pin)) return false;
  return safeEqual(token, cfg.token) && safeEqual(pin, cfg.pin);
}

const buckets = new Map();

export function rateLimit(key, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  let hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 1000) {
    for (const [k, arr] of buckets) {
      if (arr.filter((t) => now - t < windowMs).length === 0) buckets.delete(k);
    }
  }
  return false;
}

export function checkRateLimited(req, cfg, limit) {
  return rateLimit(`${clientIp(req)}|${req.url.split('?')[0]}`, limit || 30);
}

export function limitAuthFailures(req) {
  return rateLimit(`${clientIp(req)}|authfail`, 10, 60_000);
}
