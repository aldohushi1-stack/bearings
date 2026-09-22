import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { scan, compileIgnore, matchesIgnore } from '../src/scan.mjs';
import { fingerprint } from '../src/fingerprint.mjs';
import { fixture, tempDir, writeTree, rm } from './helpers.mjs';

const paths = (s) => s.entries.filter((e) => !e.dir).map((e) => e.path);

test('scan lists files with forward slashes and skips default ignores', async () => {
  const s = await scan(fixture('node-cli'));
  const p = paths(s);
  assert.ok(p.includes('src/cli.mjs'));
  assert.ok(p.includes('.github/workflows/ci.yml'));
  assert.ok(p.every((x) => !x.includes('\\')), 'no backslashes');
  assert.ok(!p.some((x) => x.startsWith('node_modules/')), 'node_modules skipped');
  assert.equal(s.skipped['node_modules'], 1, 'skipped dirs are counted by name');
});

test('scan honours .gitignore: dir/, *.ext, /anchored, !negation', async () => {
  const s = await scan(fixture('node-cli'));
  const p = paths(s);
  assert.ok(!p.includes('dist/bundle.js'), 'dist/ ignored (also a default)');
  assert.ok(!p.includes('debug.log'), '*.log ignored');
  assert.ok(p.includes('keep.log'), '!keep.log re-included');
  assert.ok(!p.includes('secret-notes.md'), '/secret-notes.md ignored');
  assert.ok(p.includes('docs/api.md'));
});

test('scan honours .bearingsignore on top of .gitignore', async () => {
  const dir = await tempDir();
  await writeTree(dir, {
    'a.js': 'export const a = 1;',
    'b.js': 'export const b = 1;',
    'notes/x.md': '# x',
    '.bearingsignore': 'b.js\nnotes/\n',
  });
  const s = await scan(dir);
  assert.deepEqual(paths(s).sort(), ['.bearingsignore', 'a.js']);
  await rm(dir);
});

test('scan excludes the output file and .bearings/ from entries', async () => {
  const dir = await tempDir();
  await writeTree(dir, { 'a.js': '1', 'BEARINGS.md': 'old', '.bearings/state.json': '{}' });
  const s = await scan(dir, { outFile: 'BEARINGS.md' });
  assert.deepEqual(paths(s), ['a.js']);
  await rm(dir);
});

test('scan caps depth and entry count deterministically', async () => {
  const dir = await tempDir();
  const files = {};
  for (let i = 0; i < 30; i++) files[`d/${i}.txt`] = String(i);
  files['a/b/c/d/e/f/g/h/i/deep.txt'] = 'deep';
  await writeTree(dir, files);
  const s = await scan(dir, { maxDepth: 3, maxEntries: 10 });
  assert.ok(s.truncated, 'reports truncation');
  assert.ok(s.entries.length <= 10);
  assert.ok(!paths(s).some((p) => p.includes('deep.txt')), 'depth cap respected');
  const s2 = await scan(dir, { maxDepth: 3, maxEntries: 10 });
  assert.deepEqual(paths(s), paths(s2), 'same result twice');
  await rm(dir);
});

test('scan classifies extensions and marks binaries as assets', async () => {
  const s = await scan(fixture('node-cli'));
  const png = s.entries.find((e) => e.path === 'docs/logo.png');
  assert.equal(png.asset, true);
  const js = s.entries.find((e) => e.path === 'src/cli.mjs');
  assert.equal(js.asset, false);
  assert.equal(js.ext, 'mjs');
});

test('compileIgnore / matchesIgnore cover the documented forms', () => {
  const rules = compileIgnore(['dist/', '*.log', '/top.md', 'sub/inner', '**/gen', '!keep.log', '# comment', '']);
  assert.equal(matchesIgnore(rules, 'dist', true), true);
  assert.equal(matchesIgnore(rules, 'dist/x.js', false), true);
  assert.equal(matchesIgnore(rules, 'a/b.log', false), true);
  assert.equal(matchesIgnore(rules, 'keep.log', false), false, 'negation wins');
  assert.equal(matchesIgnore(rules, 'top.md', false), true);
  assert.equal(matchesIgnore(rules, 'x/top.md', false), false, 'anchored pattern only matches at root');
  assert.equal(matchesIgnore(rules, 'sub/inner', true), true);
  assert.equal(matchesIgnore(rules, 'sub/inner/file', false), true);
  assert.equal(matchesIgnore(rules, 'deep/er/gen', true), true);
  assert.equal(matchesIgnore(rules, 'src/main.js', false), false);
});

test('fingerprint is stable, ignores the output file, and sees a change', async () => {
  const dir = await tempDir();
  await writeTree(dir, { 'a.js': '1', 'b.js': '2' });
  const fp = async () => fingerprint(dir, await scan(dir, { outFile: 'BEARINGS.md' }));
  const f1 = await fp();
  assert.equal(await fp(), f1);
  assert.match(f1, /^[0-9a-f]{64}$/);
  await writeTree(dir, { 'BEARINGS.md': 'map', '.bearings/state.json': '{}' });
  assert.equal(await fp(), f1, 'writing the map does not change it');
  await writeTree(dir, { 'a.js': '111' });
  assert.notEqual(await fp(), f1, 'content size change is seen');
  await rm(dir);
});

test('fingerprint is content-based: mtimes do not move it, same-size edits do', async () => {
  const dir = await tempDir();
  await writeTree(dir, { 'a.js': 'aaa', 'b.js': 'bbb' });
  const fp = async () => fingerprint(dir, await scan(dir, { outFile: 'BEARINGS.md' }));
  const f1 = await fp();

  const later = new Date(Date.now() + 1000 * 60 * 60);
  await fs.utimes(path.join(dir, 'a.js'), later, later);
  assert.equal(await fp(), f1, 'touching a file does not change the fingerprint');

  await writeTree(dir, { 'a.js': 'zzz' });                    // same length, different bytes
  assert.notEqual(await fp(), f1, 'a same-size edit is seen');
  await rm(dir);
});

test('fingerprint never reads a credential-looking file', async () => {
  const dir = await tempDir();
  await writeTree(dir, { 'a.js': '1', '.env': 'API_KEY=one' });
  const fp = async () => fingerprint(dir, await scan(dir, { outFile: 'BEARINGS.md' }));
  const f1 = await fp();
  await writeTree(dir, { '.env': 'API_KEY=two' });             // same size, different secret
  assert.equal(await fp(), f1, '.env contents are never read, so they cannot move the fingerprint');
  await writeTree(dir, { '.env': 'API_KEY=a much longer secret' });
  assert.notEqual(await fp(), f1, 'but its size still counts');
  await rm(dir);
});
