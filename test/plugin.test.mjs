import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_MATCHER, isOurs } from '../src/hook.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (p) => JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8'));

test('plugin manifest, marketplace and package agree on name and version', async () => {
  const pkg = await readJson('package.json');
  const plugin = await readJson('.claude-plugin/plugin.json');
  const market = await readJson('.claude-plugin/marketplace.json');
  assert.equal(plugin.name, 'bearings');
  assert.equal(plugin.version, pkg.version);
  assert.equal(market.name, 'get-bearings');
  assert.equal(market.plugins[0].name, 'bearings');
  assert.equal(market.plugins[0].version, pkg.version);
  assert.equal(market.plugins[0].source, './');
  assert.equal(plugin.hooks, './hooks/hooks.json');
});

test('plugin hook uses the same matcher, points at a real file, and is recognised as ours', async () => {
  const hooks = await readJson('hooks/hooks.json');
  const group = hooks.hooks.SessionStart[0];
  assert.equal(group.matcher, HOOK_MATCHER);
  const h = group.hooks[0];
  assert.equal(h.type, 'command');
  assert.ok(h.command.includes('${CLAUDE_PLUGIN_ROOT}'));
  const rel = h.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/)[1];
  assert.ok((await fs.stat(path.join(ROOT, rel))).isFile(), `${rel} exists`);
  assert.ok(isOurs(h), 'isOurs() recognises the plugin command');
  assert.equal(h.timeout, 30);
});

test('published files list covers everything the bin imports', async () => {
  const pkg = await readJson('package.json');
  assert.deepEqual(pkg.files.slice(0, 2), ['bin', 'src']);
  assert.equal(pkg.bin.bearings, 'bin/bearings.mjs');
  assert.equal(pkg.type, 'module');
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  assert.deepEqual(deps, [], 'zero dependencies');
});
