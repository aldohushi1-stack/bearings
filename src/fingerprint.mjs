import { createHash } from 'node:crypto';

/** SHA-256 over every walked file's path, size and mtime. Directories and the map itself are excluded. */
export function fingerprint(scanResult) {
  const h = createHash('sha256');
  for (const e of scanResult.entries) {
    if (e.dir) continue;
    h.update(`${e.path}\0${e.size}\0${Math.floor(e.mtimeMs)}\n`);
  }
  return h.digest('hex');
}
