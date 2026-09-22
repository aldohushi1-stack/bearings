#!/usr/bin/env node
// Runs test/*.test.mjs with node's own test runner, on every Node ≥ 20 and every shell.
//
// Why not `node --test test/*.test.mjs` in package.json: Node 20's runner does not expand
// globs itself, so on Windows — where the shell doesn't either — it receives the literal
// string and fails with "Could not find 'test/*.test.mjs'". (CI run #1, windows-latest / Node 20.)
// And a bare `node --test` would also pick up the fixture projects under test/fixtures/.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(path.join(root, 'test'))
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => path.join('test', f));

if (!files.length) { console.error('no test files found under test/'); process.exit(1); }

const extra = process.argv.slice(2); // e.g. --test-name-pattern=…
const r = spawnSync(process.execPath, ['--test', ...extra, ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
