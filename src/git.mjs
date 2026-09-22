/**
 * Minimal read-only git history, in pure Node.
 *
 * "Recent" used to be the five files with the newest mtimes. mtimes are not a property of the
 * tree — a clone, a checkout or a merge restamps them — so the map changed without the project
 * changing, and `bearings check` (advertised as a CI gate) went red on a pristine clone. When a
 * repository is present the commit history is the honest answer: it is the same for everyone who
 * clones it.
 *
 * Reads .git directly. No subprocess, no dependency: object bodies are zlib streams and zlib is
 * stdlib. Loose objects and packfiles (including OFS_DELTA/REF_DELTA chains) are both handled,
 * because a fresh clone keeps everything in a pack — which is exactly the case that was broken.
 *
 * Every entry point returns null rather than throwing: a map is never worth failing a session for.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const SHA = /^[0-9a-f]{40}$/;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** `.git` is usually a directory, but a worktree or submodule leaves a `gitdir:` pointer file. */
export async function gitDir(root) {
  const p = path.join(root, '.git');
  let st;
  try { st = await fs.stat(p); } catch { return null; }
  if (st.isDirectory()) return p;
  try {
    const m = (await fs.readFile(p, 'utf8')).match(/^gitdir:\s*(.+)$/m);
    if (!m) return null;
    const d = m[1].trim();
    return path.isAbsolute(d) ? d : path.resolve(root, d);
  } catch { return null; }
}

/** HEAD → commit sha, following one symbolic ref, loose refs then packed-refs. */
async function headCommit(gd) {
  let head;
  try { head = (await fs.readFile(path.join(gd, 'HEAD'), 'utf8')).trim(); } catch { return null; }
  if (SHA.test(head)) return head;                              // detached
  const m = head.match(/^ref:\s*(\S+)$/);
  if (!m) return null;
  const ref = m[1];
  try {
    const direct = (await fs.readFile(path.join(gd, ref), 'utf8')).trim();
    if (SHA.test(direct)) return direct;
  } catch {}
  try {
    for (const line of (await fs.readFile(path.join(gd, 'packed-refs'), 'utf8')).split('\n')) {
      const mm = line.match(/^([0-9a-f]{40})\s+(\S+)\s*$/);
      if (mm && mm[2] === ref) return mm[1];
    }
  } catch {}
  return null;                                                   // unborn branch: no commits yet
}

/* ------------------------------------------------------------------ packfiles */

/** Parse a v2 .idx into { shas, offsets } so a sha can be binary-searched to a pack offset. */
function parseIdx(buf) {
  if (buf.readUInt32BE(0) !== 0xff744f63 || buf.readUInt32BE(4) !== 2) return null; // v1 is pre-2007
  const count = buf.readUInt32BE(8 + 255 * 4);
  const shaAt = 8 + 256 * 4;
  const crcAt = shaAt + count * 20;
  const offAt = crcAt + count * 4;
  const bigAt = offAt + count * 4;
  return { buf, count, shaAt, offAt, bigAt };
}

function idxLookup(idx, sha) {
  const target = Buffer.from(sha, 'hex');
  let lo = 0, hi = idx.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    // Compare from the target, not the index: buf.compare() reports order relative to its receiver.
    const cmp = target.compare(idx.buf, idx.shaAt + mid * 20, idx.shaAt + mid * 20 + 20, 0, 20);
    if (cmp === 0) {
      const off = idx.buf.readUInt32BE(idx.offAt + mid * 4);
      if (!(off & 0x80000000)) return off;
      const big = (off & 0x7fffffff) * 8;                        // MSB set: index into 8-byte table
      return Number(idx.buf.readBigUInt64BE(idx.bigAt + big));
    }
    if (cmp < 0) hi = mid - 1; else lo = mid + 1;
  }
  return null;
}

/** Inflate at `offset`, growing the read window until the stream is complete. */
async function inflateAt(fh, offset, size) {
  // A zlib stream's compressed length is not recorded, so read a window and grow on truncation.
  let want = Math.max(1024, Math.min(size * 2 + 128, 1 << 16));
  for (let attempt = 0; attempt < 6; attempt++) {
    const buf = Buffer.alloc(want);
    const { bytesRead } = await fh.read(buf, 0, want, offset);
    try {
      const out = zlib.inflateSync(buf.subarray(0, bytesRead));
      if (out.length >= size) return out.subarray(0, size);
    } catch {}
    if (bytesRead < want) break;                                 // hit EOF; no more to give
    want *= 4;
  }
  return null;
}

function readVarSize(buf, p) {
  let c = buf[p++], size = c & 0x0f, shift = 4;
  while (c & 0x80) { c = buf[p++]; size |= (c & 0x7f) << shift; shift += 7; }
  return [size, p];
}

/** Apply a git delta (copy/insert opcodes) to `base`. */
function applyDelta(delta, base) {
  let p = 0, c, shift;
  c = delta[p++]; shift = 7; let baseSize = c & 0x7f;
  while (c & 0x80) { c = delta[p++]; baseSize |= (c & 0x7f) << shift; shift += 7; }
  c = delta[p++]; shift = 7; let outSize = c & 0x7f;
  while (c & 0x80) { c = delta[p++]; outSize |= (c & 0x7f) << shift; shift += 7; }
  if (baseSize !== base.length) return null;
  const out = Buffer.alloc(outSize);
  let o = 0;
  while (p < delta.length) {
    const cmd = delta[p++];
    if (cmd & 0x80) {
      let off = 0, len = 0;
      if (cmd & 0x01) off |= delta[p++];
      if (cmd & 0x02) off |= delta[p++] << 8;
      if (cmd & 0x04) off |= delta[p++] << 16;
      if (cmd & 0x08) off |= delta[p++] * 0x1000000;
      if (cmd & 0x10) len |= delta[p++];
      if (cmd & 0x20) len |= delta[p++] << 8;
      if (cmd & 0x40) len |= delta[p++] << 16;
      if (len === 0) len = 0x10000;
      base.copy(out, o, off, off + len);
      o += len;
    } else if (cmd) {
      delta.copy(out, o, p, p + cmd);
      o += cmd; p += cmd;
    } else return null;                                          // 0x00 is reserved
  }
  return o === outSize ? out : null;
}

const PACK_TYPES = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };

/* ------------------------------------------------------------------ object store */

class Store {
  constructor(gd) { this.gd = gd; this.packs = null; this.cache = new Map(); }

  async close() {
    for (const p of this.packs || []) await p.fh.close().catch(() => {});
    this.packs = null;
  }

  async loadPacks() {
    if (this.packs) return this.packs;
    this.packs = [];
    const dir = path.join(this.gd, 'objects', 'pack');
    let names;
    try { names = await fs.readdir(dir); } catch { return this.packs; }
    for (const n of names.filter((x) => x.endsWith('.idx')).sort()) {
      try {
        const idx = parseIdx(await fs.readFile(path.join(dir, n)));
        if (!idx) continue;
        const fh = await fs.open(path.join(dir, n.replace(/\.idx$/, '.pack')), 'r');
        this.packs.push({ idx, fh });
      } catch {}
    }
    return this.packs;
  }

  async loose(sha) {
    const p = path.join(this.gd, 'objects', sha.slice(0, 2), sha.slice(2));
    let raw;
    try { raw = zlib.inflateSync(await fs.readFile(p)); } catch { return null; }
    const nul = raw.indexOf(0);
    if (nul < 0) return null;
    const m = raw.subarray(0, nul).toString('latin1').match(/^(\w+) (\d+)$/);
    return m ? { type: m[1], data: raw.subarray(nul + 1) } : null;
  }

  /** Read one entry from a pack, resolving delta chains iteratively (chains can be deep). */
  async fromPack(pack, offset) {
    const chain = [];
    let cur = offset;
    for (let hops = 0; hops < 64; hops++) {
      const head = Buffer.alloc(32);
      await pack.fh.read(head, 0, 32, cur);
      const type = (head[0] >> 4) & 7;
      let [size, p] = readVarSize(head, 0);
      if (type === 6) {                                          // OFS_DELTA: base is earlier in pack
        let c = head[p++], off = c & 0x7f;
        while (c & 0x80) { c = head[p++]; off = ((off + 1) << 7) | (c & 0x7f); }
        const data = await inflateAt(pack.fh, cur + p, size);
        if (!data) return null;
        chain.push({ delta: data });
        cur = cur - off;
        continue;
      }
      if (type === 7) {                                          // REF_DELTA: base named by sha
        const base = head.subarray(p, p + 20).toString('hex');
        const data = await inflateAt(pack.fh, cur + p + 20, size);
        if (!data) return null;
        chain.push({ delta: data });
        const resolved = await this.read(base);
        if (!resolved) return null;
        return this.unwind(chain, resolved);
      }
      const name = PACK_TYPES[type];
      if (!name) return null;
      const data = await inflateAt(pack.fh, cur + p, size);
      if (!data) return null;
      return this.unwind(chain, { type: name, data });
    }
    return null;
  }

  unwind(chain, base) {
    let out = base;
    for (let i = chain.length - 1; i >= 0; i--) {
      const applied = applyDelta(chain[i].delta, out.data);
      if (!applied) return null;
      out = { type: out.type, data: applied };
    }
    return out;
  }

  async read(sha) {
    if (this.cache.has(sha)) return this.cache.get(sha);
    let obj = await this.loose(sha);
    if (!obj) {
      for (const pack of await this.loadPacks()) {
        const off = idxLookup(pack.idx, sha);
        if (off === null) continue;
        obj = await this.fromPack(pack, off);
        if (obj) break;
      }
    }
    this.cache.set(sha, obj);
    return obj;
  }
}

/* ------------------------------------------------------------------ commits and trees */

function parseCommit(data) {
  const text = data.toString('utf8');
  const end = text.indexOf('\n\n');
  const head = end < 0 ? text : text.slice(0, end);
  const tree = head.match(/^tree ([0-9a-f]{40})$/m);
  const parents = [...head.matchAll(/^parent ([0-9a-f]{40})$/gm)].map((m) => m[1]);
  return tree ? { tree: tree[1], parents } : null;
}

/** Tree entries are `<mode> <name>\0<20 raw sha bytes>`, with no length prefix. */
function parseTree(data) {
  const out = new Map();
  let p = 0;
  while (p < data.length) {
    const sp = data.indexOf(0x20, p);
    if (sp < 0) break;
    const nul = data.indexOf(0, sp);
    if (nul < 0) break;
    const mode = data.subarray(p, sp).toString('latin1');
    const name = data.subarray(sp + 1, nul).toString('utf8');
    out.set(name, { mode, sha: data.subarray(nul + 1, nul + 21).toString('hex'), dir: mode === '40000' || mode === '040000' });
    p = nul + 21;
  }
  return out;
}

async function treeOf(store, sha) {
  if (sha === EMPTY_TREE) return new Map();
  const obj = await store.read(sha);
  return obj && obj.type === 'tree' ? parseTree(obj.data) : new Map();
}

/** Files present in `b` but changed or absent in `a`. Deletions are skipped: they are not there to read. */
async function diffTrees(store, aSha, bSha, prefix, out, limit) {
  if (out.length >= limit || aSha === bSha) return;
  const [a, b] = [await treeOf(store, aSha), await treeOf(store, bSha)];
  for (const name of [...b.keys()].sort()) {
    if (out.length >= limit) return;
    const be = b.get(name), ae = a.get(name);
    if (ae && ae.sha === be.sha) continue;
    const full = prefix ? `${prefix}/${name}` : name;
    if (be.dir) await diffTrees(store, ae && ae.dir ? ae.sha : EMPTY_TREE, be.sha, full, out, limit);
    else if (!out.includes(full)) out.push(full);
  }
}

/**
 * Paths touched by the most recent commits, newest first.
 * Returns null when there is no repository or no commit to read — the caller falls back to mtimes.
 */
export async function recentFromGit(root, { limit = 5, maxCommits = 40 } = {}) {
  const gd = await gitDir(root);
  if (!gd) return null;
  const store = new Store(gd);
  try {
    let sha = await headCommit(gd);
    if (!sha) return null;
    const out = [];
    for (let i = 0; i < maxCommits && sha && out.length < limit; i++) {
      const obj = await store.read(sha);
      if (!obj || obj.type !== 'commit') break;
      const commit = parseCommit(obj.data);
      if (!commit) break;
      // A root commit — or a shallow clone's grafted base — has no readable parent: diff against nothing.
      let parentTree = EMPTY_TREE;
      if (commit.parents.length) {
        const p = await store.read(commit.parents[0]);
        const pc = p && p.type === 'commit' ? parseCommit(p.data) : null;
        if (pc) parentTree = pc.tree;
      }
      await diffTrees(store, parentTree, commit.tree, '', out, limit);
      sha = commit.parents[0] || null;
    }
    return out.length ? out : null;
  } catch {
    return null;
  } finally {
    await store.close();
  }
}
