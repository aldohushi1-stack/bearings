import fs from 'node:fs';
import path from 'node:path';
import { build, isStale } from './build.mjs';

/** Rebuild on change, debounced. Falls back to polling where recursive fs.watch is unavailable. */
export async function watch(root, { budget, out, log = () => {}, interval = 2000 } = {}) {
  root = path.resolve(root);
  const r = await build(root, { budget, out });
  log(`${out} ${r.changed ? 'written' : 'unchanged'} · est. ${r.estimate} tokens · watching ${root}`);
  let timer = null;
  let building = false;
  const rebuild = async () => {
    if (building) return;
    building = true;
    try {
      const res = await build(root, { budget, out });
      if (res.changed) log(`${new Date().toLocaleTimeString()} ${out} rebuilt · est. ${res.estimate} tokens`);
    } catch (e) { log(`bearings: ${e.message}`); }
    building = false;
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, 500); };
  const ignored = (file) => !file || file.startsWith('.bearings') || file.replace(/\\/g, '/') === out;

  let failed = false;
  try {
    const w = fs.watch(root, { recursive: true }, (_ev, file) => { if (!ignored(file)) schedule(); });
    await new Promise((resolve) => {
      w.on('error', (e) => { failed = true; log(`watch error: ${e.message}`); resolve(); });
      process.on('SIGINT', () => { w.close(); resolve(); });
    });
    if (!failed) return;
  } catch { failed = true; }
  log('recursive watch unavailable here — polling every 2 s');
  for (;;) {
    await new Promise((res) => setTimeout(res, interval));
    try { if (await isStale(root, { outFile: out })) await rebuild(); } catch (e) { log(`bearings: ${e.message}`); return; }
  }
}
