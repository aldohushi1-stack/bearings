import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { recentFromGit } from '../src/git.mjs';
import { detect } from '../src/detect.mjs';
import { scan } from '../src/scan.mjs';
import { render } from '../src/render.mjs';
import { tempDir, writeTree, rm } from './helpers.mjs';

// The library never runs git; the tests do, to build real repositories to read.
let HAS_GIT = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { HAS_GIT = false; }
const needsGit = { skip: HAS_GIT ? false : 'git is not installed' };

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });

/** A repo with two commits: the first adds three files, the second touches one and adds one. */
async function repo() {
  const dir = await tempDir('bearings-git-');
  await writeTree(dir, {
    'README.md': '# demo\n',
    'src/a.js': 'export const a = 1;\n',
    'src/b.js': 'export const b = 2;\n'.repeat(80),   // big enough to be worth deltifying
  });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'first');
  await writeTree(dir, { 'src/b.js': 'export const b = 3;\n'.repeat(80), 'docs/guide.md': 'hi\n' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'second');
  return dir;
}

test('recentFromGit returns null when there is no repository', async () => {
  const dir = await tempDir();
  await writeTree(dir, { 'a.js': '1' });
  assert.equal(await recentFromGit(dir), null);
  await rm(dir);
});

test('recentFromGit returns null for a repo with no commits', needsGit, async () => {
  const dir = await tempDir('bearings-git-');
  await writeTree(dir, { 'a.js': '1' });
  git(dir, 'init', '-q', '-b', 'main');
  assert.equal(await recentFromGit(dir), null, 'unborn HEAD falls back to mtimes');
  await rm(dir);
});

test('recentFromGit reads loose objects, newest commit first', needsGit, async () => {
  const dir = await repo();
  const got = await recentFromGit(dir, { limit: 10 });
  assert.deepEqual(got.slice(0, 2), ['docs/guide.md', 'src/b.js'], 'second commit first, sorted within it');
  assert.ok(got.includes('README.md') && got.includes('src/a.js'), 'first commit follows');
  await rm(dir);
});

test('recentFromGit reads packed objects and delta chains', needsGit, async () => {
  const dir = await repo();
  const loose = await recentFromGit(dir, { limit: 10 });
  git(dir, 'repack', '-adq');                 // everything into one packfile, loose objects pruned
  git(dir, 'prune-packed', '-q');
  const objDirs = (await fs.readdir(path.join(dir, '.git', 'objects'))).filter((n) => /^[0-9a-f]{2}$/.test(n));
  assert.equal(objDirs.length, 0, 'objects really are packed now');
  assert.deepEqual(await recentFromGit(dir, { limit: 10 }), loose, 'same answer from the pack');
  await rm(dir);
});

test('recentFromGit ignores mtimes: touching a file does not reorder it', needsGit, async () => {
  const dir = await repo();
  const before = await recentFromGit(dir, { limit: 10 });
  const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365);
  await fs.utimes(path.join(dir, 'docs', 'guide.md'), old, old);   // oldest on disk, newest in git
  const future = new Date(Date.now() + 1000 * 60 * 60);
  await fs.utimes(path.join(dir, 'README.md'), future, future);    // newest on disk, oldest in git
  assert.deepEqual(await recentFromGit(dir, { limit: 10 }), before);
  await rm(dir);
});

test('detect prefers git history for Recent, and says so', needsGit, async () => {
  const dir = await repo();
  const future = new Date(Date.now() + 1000 * 60 * 60);
  await fs.utimes(path.join(dir, 'README.md'), future, future);
  const m = await detect(dir, await scan(dir));
  assert.equal(m.recentSource, 'git');
  assert.equal(m.recent[0], 'docs/guide.md', 'git order wins over the newest mtime');
  await rm(dir);
});

test('detect falls back to mtimes when there is no repository', async () => {
  const dir = await tempDir();
  await writeTree(dir, { 'a.js': '1', 'b.js': '2' });
  const future = new Date(Date.now() + 1000 * 60 * 60);
  await fs.utimes(path.join(dir, 'a.js'), future, future);
  const m = await detect(dir, await scan(dir));
  assert.equal(m.recentSource, 'mtime');
  assert.equal(m.recent[0], 'a.js');
  await rm(dir);
});

test('the rendered map does not depend on checkout mtimes', needsGit, async () => {
  // The regression this module exists for. A checkout restamps every mtime, in whatever order the
  // files happen to be written, so an mtime-ranked Recent section rendered the same commit
  // differently on different machines. The footer's fingerprint is mtime-derived by design (it is
  // the staleness key, not content), so it is pinned here; everything else must match.
  const origin = await repo();
  const map = async (dir) => {
    const model = await detect(dir, await scan(dir));
    model.fingerprint = '0'.repeat(64);
    return render(model, { budget: 1500 }).markdown;
  };

  const a = await tempDir('bearings-clone-a-');
  const b = await tempDir('bearings-clone-b-');
  await rm(a); await rm(b);
  execFileSync('git', ['clone', '-q', origin, a], { stdio: 'pipe' });
  execFileSync('git', ['clone', '-q', origin, b], { stdio: 'pipe' });

  // Stamp the two checkouts in opposite orders: same commit, mirror-image mtimes.
  const files = ['README.md', 'src/a.js', 'src/b.js', 'docs/guide.md'];
  for (let i = 0; i < files.length; i++) {
    const early = new Date(Date.now() + i * 60_000);
    const late = new Date(Date.now() + (files.length - i) * 60_000);
    await fs.utimes(path.join(a, files[i]), early, early);
    await fs.utimes(path.join(b, files[i]), late, late);
  }

  const [ma, mb] = [await map(a), await map(b)];
  assert.ok(ma.includes('## Recent'), 'the section under test is present');
  assert.equal(ma, mb, 'same commit, same map');
  await rm(origin); await rm(a); await rm(b);
});
