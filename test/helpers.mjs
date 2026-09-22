import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const fixture = (name) => path.join(FIXTURES, name);

/** Copy a fixture into a fresh temp dir (so tests can write, touch, and build). */
export async function tempCopy(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `bearings-${name}-`));
  await fs.cp(fixture(name), dir, { recursive: true });
  return dir;
}

export async function tempDir(prefix = 'bearings-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
}

export const rm = (dir) => fs.rm(dir, { recursive: true, force: true });
