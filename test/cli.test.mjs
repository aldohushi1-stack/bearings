import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { main } from '../src/cli.mjs';
import { tempCopy, tempDir, writeTree, rm } from './helpers.mjs';

function io(stdinText = '') {
  const out = [], err = [];
  return {
    opts: { stdout: (s) => out.push(s), stderr: (s) => err.push(s), stdin: async () => stdinText },
    out: () => out.join(''), err: () => err.join(''),
  };
}

test('build writes BEARINGS.md and .bearings/state.json; check goes 0 → 1 → 0', async () => {
  const dir = await tempCopy('node-cli');
  let t = io();
  assert.equal(await main(['build', dir], t.opts), 0);
  const md = await fs.readFile(path.join(dir, 'BEARINGS.md'), 'utf8');
  assert.ok(md.startsWith('# widget-cli'));
  const state = JSON.parse(await fs.readFile(path.join(dir, '.bearings', 'state.json'), 'utf8'));
  assert.match(state.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(state.budget, 1500);
  assert.ok(t.out().includes('BEARINGS.md'), 'reports where it wrote');

  t = io();
  assert.equal(await main(['check', dir], t.opts), 0, 'fresh');
  await writeTree(dir, { 'src/new.mjs': 'export const n = 1;' });
  t = io();
  assert.equal(await main(['check', dir], t.opts), 1, 'stale after a change');
  assert.ok(t.err().includes('stale'));
  assert.equal(await main(['build', dir, '--quiet'], io().opts), 0);
  assert.equal(await main(['check', dir], io().opts), 0, 'fresh again');
  await rm(dir);
});

test('build --budget and --out are respected; --json writes map.json; --print prints', async () => {
  const dir = await tempCopy('node-cli');
  const t = io();
  assert.equal(await main(['build', dir, '--budget', '400', '--out', 'docs/MAP.md', '--json', '--print'], t.opts), 0);
  const md = await fs.readFile(path.join(dir, 'docs', 'MAP.md'), 'utf8');
  assert.ok(md.includes('budget 400'));
  assert.ok(t.out().includes('# widget-cli'), '--print echoes the map');
  const json = JSON.parse(await fs.readFile(path.join(dir, '.bearings', 'map.json'), 'utf8'));
  assert.equal(json.name, 'widget-cli');
  assert.ok(Array.isArray(json.modules));
  await rm(dir);
});

test('a second build with no change is byte-identical and reports "unchanged"', async () => {
  const dir = await tempCopy('python-pkg');
  await main(['build', dir], io().opts);
  const a = await fs.readFile(path.join(dir, 'BEARINGS.md'), 'utf8');
  const t = io();
  await main(['build', dir], t.opts);
  const b = await fs.readFile(path.join(dir, 'BEARINGS.md'), 'utf8');
  assert.equal(a, b);
  assert.ok(t.out().includes('unchanged'));
  await rm(dir);
});

test('print rebuilds when stale and prints the map', async () => {
  const dir = await tempCopy('single-html');
  const t = io();
  assert.equal(await main(['print', dir], t.opts), 0);
  assert.ok(t.out().includes('# Millimetres'));
  assert.ok((await fs.stat(path.join(dir, 'BEARINGS.md'))).isFile(), 'print builds when nothing exists');
  await rm(dir);
});

test('emit: valid SessionStart hook JSON from stdin cwd', async () => {
  const dir = await tempCopy('node-cli');
  const t = io(JSON.stringify({ session_id: 'x', cwd: dir, hook_event_name: 'SessionStart', source: 'startup' }));
  assert.equal(await main(['emit'], t.opts), 0);
  const obj = JSON.parse(t.out());
  assert.equal(obj.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(obj.hookSpecificOutput.additionalContext.startsWith('# widget-cli'));
  assert.ok((await fs.stat(path.join(dir, 'BEARINGS.md'))).isFile(), 'emit builds the file too');
  await rm(dir);
});

test('emit never fails the session: bad stdin, missing dir, unreadable dir → exit 0, empty stdout', async () => {
  let t = io('not json');
  assert.equal(await main(['emit'], { ...t.opts, cwd: '/definitely/not/here' }), 0);
  assert.equal(t.out(), '');
  t = io(JSON.stringify({ cwd: '/definitely/not/here' }));
  assert.equal(await main(['emit'], t.opts), 0);
  assert.equal(t.out(), '');
});

test('emit falls back to process cwd when stdin has no cwd', async () => {
  const dir = await tempCopy('single-html');
  const t = io('{}');
  assert.equal(await main(['emit'], { ...t.opts, cwd: dir }), 0);
  assert.ok(t.out().includes('Millimetres'));
  await rm(dir);
});

test('--version and --help', async () => {
  let t = io();
  assert.equal(await main(['--version'], t.opts), 0);
  assert.match(t.out(), /^\d+\.\d+\.\d+\n$/);
  t = io();
  assert.equal(await main(['--help'], t.opts), 0);
  assert.ok(t.out().includes('bearings init'));
  t = io();
  assert.equal(await main(['bogus'], t.opts), 2);
  assert.ok(t.err().includes('Unknown command'));
});

test('an empty folder still builds a map', async () => {
  const dir = await tempDir();
  const t = io();
  assert.equal(await main(['build', dir, '--print'], t.opts), 0);
  assert.ok(t.out().includes('empty'));
  await rm(dir);
});
