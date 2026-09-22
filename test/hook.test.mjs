import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installHook, uninstallHook, findOurHooks, HOOK_MATCHER, DEFAULT_COMMAND } from '../src/hook.mjs';
import { main } from '../src/cli.mjs';
import { tempCopy, tempDir, writeTree, rm } from './helpers.mjs';

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

test('installHook writes the documented shape into a fresh settings file', async () => {
  const dir = await tempDir();
  const settings = path.join(dir, '.claude', 'settings.json');
  const r = await installHook({ settingsPath: settings });
  assert.equal(r.changed, true);
  const s = await readJson(settings);
  assert.deepEqual(s, {
    hooks: { SessionStart: [{ matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: DEFAULT_COMMAND, timeout: 30 }] }] },
  });
  assert.equal(HOOK_MATCHER, 'startup|resume|clear|compact');
  assert.equal(DEFAULT_COMMAND, 'npx -y get-bearings emit');
  await rm(dir);
});

test('installHook is idempotent, preserves other hooks and settings, honours --command and --budget', async () => {
  const dir = await tempDir();
  const settings = path.join(dir, 'settings.json');
  await writeTree(dir, {
    'settings.json': JSON.stringify({
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'npx -y glassbox-trace hook' }] }],
      },
    }),
  });
  const r1 = await installHook({ settingsPath: settings, command: 'bearings', budget: 900 });
  assert.equal(r1.changed, true);
  const r2 = await installHook({ settingsPath: settings, command: 'bearings', budget: 900 });
  assert.equal(r2.changed, false, 'second install is a no-op');
  const s = await readJson(settings);
  assert.deepEqual(s.permissions, { allow: ['Bash(npm test)'] });
  assert.equal(s.hooks.Stop[0].hooks[0].command, 'npx -y glassbox-trace hook');
  assert.equal(s.hooks.SessionStart.length, 2);
  assert.equal(s.hooks.SessionStart[0].hooks[0].command, 'echo hi');
  assert.equal(s.hooks.SessionStart[1].hooks[0].command, 'bearings emit --budget 900');
  assert.equal(findOurHooks(s).length, 1);
  await rm(dir);
});

test('uninstallHook removes only ours', async () => {
  const dir = await tempDir();
  const settings = path.join(dir, 'settings.json');
  await installHook({ settingsPath: settings });
  const s0 = await readJson(settings);
  s0.hooks.SessionStart.push({ matcher: 'compact', hooks: [{ type: 'command', command: 'echo keep' }] });
  await fs.writeFile(settings, JSON.stringify(s0));
  const r = await uninstallHook({ settingsPath: settings });
  assert.equal(r.changed, true);
  const s = await readJson(settings);
  assert.equal(s.hooks.SessionStart.length, 1);
  assert.equal(s.hooks.SessionStart[0].hooks[0].command, 'echo keep');
  const r2 = await uninstallHook({ settingsPath: settings });
  assert.equal(r2.changed, false);
  await rm(dir);
});

test('uninstallHook drops empty hooks containers', async () => {
  const dir = await tempDir();
  const settings = path.join(dir, 'settings.json');
  await installHook({ settingsPath: settings });
  await uninstallHook({ settingsPath: settings });
  const s = await readJson(settings);
  assert.deepEqual(s, {});
  await rm(dir);
});

test('cli: hook install targets the project by default and home with --global', async () => {
  const dir = await tempCopy('node-cli');
  const home = await tempDir();
  const opts = { stdout: () => {}, stderr: () => {}, cwd: dir, home };
  assert.equal(await main(['hook', 'install'], opts), 0);
  const s = await readJson(path.join(dir, '.claude', 'settings.json'));
  assert.equal(findOurHooks(s).length, 1);
  assert.equal(await main(['hook', 'install', '--global'], opts), 0);
  const g = await readJson(path.join(home, '.claude', 'settings.json'));
  assert.equal(findOurHooks(g).length, 1);
  assert.equal(await main(['hook', 'uninstall', '--global'], opts), 0);
  assert.equal(findOurHooks(await readJson(path.join(home, '.claude', 'settings.json'))).length, 0);
  await rm(dir); await rm(home);
});

test('cli: init builds and installs in one go', async () => {
  const dir = await tempCopy('python-pkg');
  const out = [];
  assert.equal(await main(['init', dir], { stdout: (s) => out.push(s), stderr: () => {} }), 0);
  assert.ok((await fs.stat(path.join(dir, 'BEARINGS.md'))).isFile());
  const s = await readJson(path.join(dir, '.claude', 'settings.json'));
  assert.equal(findOurHooks(s).length, 1);
  assert.ok(out.join('').includes('hook installed'));
  await rm(dir);
});

test('cli: init appends .bearings/ to an existing .gitignore once, and never creates one', async () => {
  const dir = await tempCopy('node-cli');
  const quiet = { stdout: () => {}, stderr: () => {} };
  await main(['init', dir], quiet);
  let gi = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
  assert.ok(gi.endsWith('.bearings/\n'), gi);
  await main(['init', dir], quiet);
  assert.equal(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), gi, 'second init changes nothing');
  const bare = await tempCopy('single-html');
  await main(['init', bare], quiet);
  await assert.rejects(fs.stat(path.join(bare, '.gitignore')), 'no .gitignore is created');
  await rm(dir); await rm(bare);
});

test('settings with a broken JSON file is left alone and reported', async () => {
  const dir = await tempDir();
  const settings = path.join(dir, 'settings.json');
  await writeTree(dir, { 'settings.json': '{ not json' });
  await assert.rejects(installHook({ settingsPath: settings }), /settings/);
  assert.equal(await fs.readFile(settings, 'utf8'), '{ not json');
  await rm(dir);
});
