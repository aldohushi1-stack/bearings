import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, filesOf } from './scan.mjs';
import { fingerprint } from './fingerprint.mjs';
import { detect } from './detect.mjs';
import { extractFile, languageOf } from './extract/index.mjs';
import { importedBy } from './graph.mjs';
import { rankModules } from './rank.mjs';
import { render } from './render.mjs';

export const DEFAULT_BUDGET = 1500;
export const DEFAULT_OUT = 'BEARINGS.md';
const STATE_DIR = '.bearings';
const MAX_SOURCE_FILES = 2000;
const MAX_SOURCE_BYTES = 256 * 1024;

let cachedVersion = null;
export async function packageVersion() {
  if (cachedVersion) return cachedVersion;
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  cachedVersion = JSON.parse(await fs.readFile(p, 'utf8')).version;
  return cachedVersion;
}

async function readBounded(abs, limit) {
  const h = await fs.open(abs, 'r');
  try {
    const st = await h.stat();
    const len = Math.min(st.size, limit);
    const buf = Buffer.alloc(len);
    await h.read(buf, 0, len, 0);
    const text = buf.toString('utf8');
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } finally { await h.close(); }
}

/** Scan + detect + extract + rank. The whole picture, before rendering. */
export async function buildModel(root, { outFile = DEFAULT_OUT } = {}) {
  root = path.resolve(root);
  const s = await scan(root, { outFile });
  const model = await detect(root, s);
  model.fingerprint = fingerprint(s);
  model.outFile = outFile;

  const sources = filesOf(s).filter((f) => !f.asset && !f.sensitive && !f.lockfile && languageOf(f.path) && f.size <= MAX_SOURCE_BYTES).slice(0, MAX_SOURCE_FILES);
  const modules = [];
  for (const f of sources) {
    let text;
    try { text = await readBounded(path.join(root, f.path), MAX_SOURCE_BYTES); } catch { continue; }
    const { exports, imports } = extractFile(f.path, text);
    modules.push({ path: f.path, exports, imports });
  }
  const counts = importedBy(modules);
  model.modules = rankModules(modules, { entries: model.entries, importedBy: counts });
  return model;
}

export function statePath(root) { return path.join(root, STATE_DIR, 'state.json'); }

export async function readState(root) {
  try { return JSON.parse(await fs.readFile(statePath(root), 'utf8')); } catch { return null; }
}

/** True when there is no build, or the tree changed since the last one. */
export async function isStale(root, { outFile = DEFAULT_OUT } = {}) {
  root = path.resolve(root);
  const state = await readState(root);
  if (!state) return true;
  try { await fs.access(path.join(root, state.out || outFile)); } catch { return true; }
  const s = await scan(root, { outFile: state.out || outFile });
  return fingerprint(s) !== state.fingerprint;
}

/**
 * Build and write the map. Returns `{ markdown, estimate, dropped, changed, outPath, model }`.
 * A build whose fingerprint, budget and version match the last one is skipped (`changed: false`).
 */
export async function build(root, { budget = DEFAULT_BUDGET, out = DEFAULT_OUT, json = false, force = false, allowUnwritable = false } = {}) {
  root = path.resolve(root);
  let st;
  try { st = await fs.stat(root); } catch { throw new Error(`no such folder: ${root}`); }
  if (!st.isDirectory()) throw new Error(`not a folder: ${root}`);
  const version = await packageVersion();
  const outPath = path.isAbsolute(out) ? path.resolve(out) : path.join(root, out);
  const outFile = path.relative(root, outPath).replace(/\\/g, '/');
  const state = await readState(root);

  if (!force && state && state.out === outFile && state.budget === budget && state.version === version) {
    const s = await scan(root, { outFile });
    let existing = null;
    try { existing = await fs.readFile(outPath, 'utf8'); } catch {}
    if (existing !== null && fingerprint(s) === state.fingerprint) {
      return { markdown: existing, estimate: state.estimate, dropped: state.dropped || [], changed: false, outPath, model: null };
    }
  }

  const model = await buildModel(root, { outFile });
  const { markdown, estimate, dropped } = render(model, { budget, version });
  // Writes are best-effort: a read-only checkout still gets its map (the hook prints it either way).
  let written = true;
  try {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.mkdir(path.join(root, STATE_DIR), { recursive: true });
    await fs.writeFile(outPath, markdown, 'utf8');
    await fs.writeFile(statePath(root), JSON.stringify({
      version, fingerprint: model.fingerprint, budget, out: outFile, estimate, dropped, builtAt: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
    if (json) {
      const { layout, ...rest } = model;
      await fs.writeFile(path.join(root, STATE_DIR, 'map.json'), JSON.stringify({ ...rest, layout, modules: model.modules.map(({ path: p, exports, score, importedBy: ib }) => ({ path: p, exports, score, importedBy: ib })) }, null, 2) + '\n', 'utf8');
    }
  } catch (e) {
    if (!allowUnwritable) throw e;
    written = false;
  }
  return { markdown, estimate, dropped, changed: true, written, outPath, model };
}
