// Regressions from the 0.1.0 adversarial review. Each one reproduced a real failure before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractJs } from '../src/extract/js.mjs';
import { extractRust } from '../src/extract/rust.mjs';
import { compileIgnore, matchesIgnore, scan } from '../src/scan.mjs';
import { isOurs } from '../src/hook.mjs';
import { main } from '../src/cli.mjs';
import { tempCopy, tempDir, writeTree, rm } from './helpers.mjs';

const quiet = () => { const out = []; return { opts: { stdout: (s) => out.push(s), stderr: () => {} }, out: () => out.join('') }; };

test('JS import extraction is linear on long whitespace runs (was cubic: 22 s on 4000 spaces)', () => {
  const src = 'import ' + ' '.repeat(20000) + 'x';
  const t = performance.now();
  extractJs(src);
  assert.ok(performance.now() - t < 200, 'under 200 ms');
  const many = ('import' + ' '.repeat(500)).repeat(400);
  const t2 = performance.now();
  extractJs(many);
  assert.ok(performance.now() - t2 < 500);
  // and still finds every form
  const r = extractJs(`import a from './a.js'; import './side.css'; export * from './b.js'; export { c } from "./c.js"; import type { T } from './t';`);
  assert.deepEqual(r.imports, ['./a.js', './side.css', './b.js', './c.js', './t']);
});

test('Rust extraction is linear on whitespace-heavy files', () => {
  const src = '\n'.repeat(20000) + ' '.repeat(200000) + '\npub fn last() {}\n';
  const t = performance.now();
  const r = extractRust(src);
  assert.ok(performance.now() - t < 500);
  assert.deepEqual(r.exports, ['last']);
});

test('gitignore: character classes and a BOM are handled like git does', async () => {
  const rules = compileIgnore(['[Bb]in/', '*.py[cod]', '[Oo]bj/']);
  assert.equal(matchesIgnore(rules, 'Bin', true), true);
  assert.equal(matchesIgnore(rules, 'bin/x.dll', false), true);
  assert.equal(matchesIgnore(rules, 'a/b.pyc', false), true);
  assert.equal(matchesIgnore(rules, 'a/b.py', false), false);
  const dir = await tempDir();
  await writeTree(dir, { '.gitignore': '\uFEFF*.log\n', 'app.log': 'x', 'app.js': 'y' });
  const s = await scan(dir);
  assert.deepEqual(s.entries.filter((e) => !e.dir).map((e) => e.path), ['.gitignore', 'app.js']);
  await rm(dir);
});

test('isOurs recognises Windows-style command paths', () => {
  assert.ok(isOurs({ type: 'command', command: 'node C:\\Users\\Aldo\\bearings\\bin\\bearings.mjs emit' }));
  assert.ok(isOurs({ type: 'command', command: 'C:\\Users\\Aldo\\AppData\\Roaming\\npm\\bearings.cmd emit --budget 900' }));
  assert.ok(isOurs({ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/bearings.mjs" emit' }));
  assert.ok(!isOurs({ type: 'command', command: 'npx -y glassbox-trace hook' }));
});

test('init leaves a fresh map behind (hook + .gitignore are written before the build)', async () => {
  const dir = await tempCopy('node-cli');
  assert.equal(await main(['init', dir], quiet().opts), 0);
  assert.equal(await main(['check', dir], quiet().opts), 0, 'fresh right after init');
  await rm(dir);
});

test('emit still prints the map when the folder is read-only', { skip: process.getuid?.() === 0 ? 'root can always write' : false }, async () => {
  const dir = await tempCopy('single-html');
  await fs.chmod(dir, 0o555);
  const t = quiet();
  assert.equal(await main(['emit'], { ...t.opts, stdin: async () => JSON.stringify({ cwd: dir }) }), 0);
  assert.ok(t.out().includes('Millimetres'));
  await fs.chmod(dir, 0o755);
  await rm(dir);
});

test('--out accepts an absolute path and the map is excluded from its own scan', async () => {
  const dir = await tempCopy('single-html');
  const outDir = await tempDir();
  const outPath = path.join(outDir, 'MAP.md');
  assert.equal(await main(['build', dir, '--out', outPath], quiet().opts), 0);
  assert.ok((await fs.readFile(outPath, 'utf8')).startsWith('# Millimetres'));
  assert.equal(await main(['check', dir, '--out', outPath], quiet().opts), 0);
  await rm(dir); await rm(outDir);
});

test('flags that need a value refuse to run without one', async () => {
  const t = quiet();
  assert.equal(await main(['build', '--budget'], t.opts), 2);
});

test(".claude/settings.local.json never shows up in the map", async () => {
  const dir = await tempCopy('single-html');
  await writeTree(dir, { '.claude/settings.local.json': '{}', '.claude/settings.json': '{}' });
  const s = await scan(dir);
  const p = s.entries.map((e) => e.path);
  assert.ok(!p.includes('.claude/settings.local.json'));
  assert.ok(p.includes('.claude/settings.json'));
  await rm(dir);
});

test('ensureGitignore treats /.bearings/ and .bearings as already present', async () => {
  const dir = await tempCopy('single-html');
  await writeTree(dir, { '.gitignore': '/.bearings/\n' });
  await main(['init', dir], quiet().opts);
  assert.equal(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), '/.bearings/\n');
  await rm(dir);
});
