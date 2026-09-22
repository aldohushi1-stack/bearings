import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../src/scan.mjs';
import { detect } from '../src/detect.mjs';
import { fixture, tempDir, writeTree, rm } from './helpers.mjs';

const model = async (name) => detect(fixture(name), await scan(fixture(name)));

test('node-cli: identity, scripts, runner, lint, ci, entries, rules', async () => {
  const m = await model('node-cli');
  assert.equal(m.name, 'widget-cli');
  assert.equal(m.description, 'Counts widgets in a folder and prints a report.');
  assert.equal(m.kind, 'node-cli');
  assert.equal(m.packageManager, 'npm');
  assert.equal(m.moduleSystem, 'esm');
  assert.equal(m.languages[0].name, 'JavaScript');
  assert.deepEqual(m.scripts.map((s) => s.name), ['test', 'lint', 'build', 'start']);
  assert.equal(m.scripts[0].cmd, 'node --test');
  assert.equal(m.test.runner, 'node:test');
  assert.deepEqual(m.lint, ['eslint', 'prettier']);
  assert.deepEqual(m.ci, ['ci.yml']);
  assert.deepEqual(m.entries.sort(), ['bin/widget.mjs', 'src/index.mjs']);
  assert.equal(m.rules.claudeMd, true);
  assert.equal(m.rules.agentsMd, false);
  assert.equal(m.rules.indent, '2 spaces');
  assert.equal(m.rules.tsStrict, true);
  assert.equal(m.license, 'MIT');
  assert.deepEqual(m.envKeys, ['API_KEY', 'PORT']);
  assert.equal(m.envPresent, true, '.env is noticed but never read');
  assert.equal(m.readmeFirstParagraph, 'Counts widgets in a folder and prints a report. Handy for widget audits.');
});

test('python-pkg: pyproject identity, scripts from Makefile and project.scripts, uv, pytest, ruff', async () => {
  const m = await model('python-pkg');
  assert.equal(m.name, 'mypkg');
  assert.equal(m.kind, 'python-package');
  assert.equal(m.packageManager, 'uv');
  assert.equal(m.test.runner, 'pytest');
  assert.ok(m.lint.includes('ruff'));
  const names = m.scripts.map((s) => `${s.source}:${s.name}`);
  assert.ok(names.includes('make:test') && names.includes('make:lint'), names.join());
  assert.ok(names.includes('console:mypkg'));
  assert.deepEqual(m.entries, ['src/mypkg/cli.py']);
  assert.equal(m.rules.agentsMd, true);
});

test('single-html: kind and entries from root html', async () => {
  const m = await model('single-html');
  assert.equal(m.kind, 'single-file-web');
  assert.deepEqual(m.entries, ['game.html']);
  assert.equal(m.name, 'Millimetres', 'name from README heading when no manifest');
});

test('folder-of-projects: lists subprojects with their kinds', async () => {
  const m = await model('folder-of-projects');
  assert.equal(m.kind, 'folder-of-projects');
  assert.deepEqual(m.subprojects.map((p) => [p.path, p.kind]), [['alpha', 'node-web'], ['beta', 'python-package']]);
});

test('monorepo: workspaces + pnpm', async () => {
  const m = await model('monorepo');
  assert.equal(m.kind, 'monorepo');
  assert.equal(m.packageManager, 'pnpm');
  assert.deepEqual(m.subprojects.map((p) => p.path), ['packages/a', 'packages/b']);
});

test('docs and empty folders get sane kinds', async () => {
  const dir = await tempDir();
  await writeTree(dir, { 'a.md': '# a', 'b.md': '# b', 'c/d.md': '# d' });
  const m = await detect(dir, await scan(dir));
  assert.equal(m.kind, 'docs');
  const empty = await tempDir();
  const e = await detect(empty, await scan(empty));
  assert.equal(e.kind, 'empty');
  await rm(dir); await rm(empty);
});

test('git branch is read from .git/HEAD without a subprocess', async () => {
  const dir = await tempDir();
  await writeTree(dir, { 'a.js': '1', '.git/HEAD': 'ref: refs/heads/feature/x\n' });
  const m = await detect(dir, await scan(dir));
  assert.equal(m.gitBranch, 'feature/x');
  await rm(dir);
});
