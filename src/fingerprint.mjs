import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** The ceiling the map itself reads at: past this, no file's bytes can reach the map. */
const MAX_HASH_BYTES = 256 * 1024;
const CONCURRENCY = 8;

/**
 * SHA-256 over every walked file's path, size and content. Directories and the map itself
 * are excluded.
 *
 * Content, not mtime: mtimes are restamped by a clone, a checkout or a merge, so an mtime-based
 * fingerprint made the same tree hash differently on every machine — the map's footer changed
 * without the project changing, and `check` could not be a CI assertion.
 *
 * Not every file is read. Assets and credential-looking files are taken on path and size alone:
 * the map never prints their bytes (and never reads `.env` at all), so their contents cannot
 * change it. Everything else is hashed up to MAX_HASH_BYTES, the same ceiling `detect` reads at,
 * so a file large enough to be truncated there is hashed over exactly the part that can reach the
 * map. The rule errs toward hashing: a needless rebuild is cheap, a missed change is a wrong map.
 */
export async function fingerprint(root, scanResult) {
  const files = scanResult.entries.filter((e) => !e.dir);
  const digests = new Array(files.length).fill('');

  let next = 0;
  const worker = async () => {
    for (let i = next++; i < files.length; i = next++) {
      const e = files[i];
      if (e.asset || e.sensitive) continue;                      // bytes that cannot reach the map
      let fh;
      try {
        fh = await fs.open(path.join(root, e.path), 'r');
        const buf = Buffer.alloc(Math.min(e.size, MAX_HASH_BYTES));
        const { bytesRead } = buf.length ? await fh.read(buf, 0, buf.length, 0) : { bytesRead: 0 };
        digests[i] = createHash('sha256').update(buf.subarray(0, bytesRead)).digest('hex');
      } catch {
        digests[i] = 'unreadable';                               // a file we cannot open is a fact too
      } finally {
        await fh?.close().catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  // Hashed in scan order, which is sorted: the result must not depend on which worker finished first.
  const h = createHash('sha256');
  for (let i = 0; i < files.length; i++) h.update(`${files[i].path}\0${files[i].size}\0${digests[i]}\n`);
  return h.digest('hex');
}
