import { execFile } from 'node:child_process';

const BIN = 'playerctl';

const ACTIONS = {
  'play-pause': ['play-pause'],
  next: ['next'],
  previous: ['previous'],
  'volume-up': ['volume', '+0.05'],
  'volume-down': ['volume', '-0.05'],
};

function run(args) {
  return new Promise((resolve) => {
    execFile(BIN, args, { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: String((err.stderr || err.message || err)).trim() });
      resolve({ ok: true, out: String(stdout).trim() });
    });
  });
}

export async function command(cmd) {
  const args = ACTIONS[cmd];
  if (!args) return { ok: false, error: 'unknown command' };
  return run(args);
}

export async function status() {
  const [meta, playing, vol] = await Promise.all([
    run(['metadata', '--format', '{{artist}} - {{title}}']),
    run(['status']),
    run(['volume']),
  ]);
  const online = meta.ok || playing.ok;
  let volume = null;
  if (vol.ok && vol.out !== '') {
    const v = parseFloat(vol.out);
    if (!Number.isNaN(v)) volume = Math.max(0, Math.min(100, Math.round(v * 100)));
  }
  return {
    online,
    playing: playing.ok && playing.out === 'Playing',
    title: meta.ok && meta.out ? meta.out : null,
    volume,
  };
}
