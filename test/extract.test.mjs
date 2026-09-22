import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFile, languageOf } from '../src/extract/index.mjs';
import { resolveImport } from '../src/graph.mjs';

test('languageOf maps extensions', () => {
  assert.equal(languageOf('a.mjs'), 'js');
  assert.equal(languageOf('a.tsx'), 'js');
  assert.equal(languageOf('a.py'), 'python');
  assert.equal(languageOf('a.go'), 'go');
  assert.equal(languageOf('a.rs'), 'rust');
  assert.equal(languageOf('a.md'), null);
});

test('JS: every export form in the design', () => {
  const src = `
import { scan, walk } from './scan.mjs';
import path from 'node:path';
const dyn = await import('./lazy.mjs');
export async function main() {}
export function walk() {}
export default function widget() {}
export class Scanner {}
export const VERSION = '1';
export let mutable = 1;
export var legacy = 2;
export enum Colour { Red }
export interface Shape { x: number }
export type Point = { x: number };
const helper = 1, other = 2;
export { helper, other as alias };
export * from './re.mjs';
export { default as Thing } from './thing.mjs';
`;
  const r = extractFile('src/x.ts', src);
  assert.deepEqual(r.exports, [
    'main', 'walk', 'default:widget', 'Scanner', 'VERSION', 'mutable', 'legacy',
    'Colour', 'Shape', 'Point', 'helper', 'alias', 'Thing',
  ]);
  assert.deepEqual(r.imports, ['./scan.mjs', 'node:path', './lazy.mjs', './re.mjs', './thing.mjs']);
});

test('CommonJS: module.exports object and exports.x', () => {
  const src = `const a=1,b=2; module.exports = { a, b: b, c };\nexports.d = 4;\nconst x = require('./util.mjs'); require("left-pad");`;
  const r = extractFile('src/legacy.cjs', src);
  assert.deepEqual(r.exports, ['a', 'b', 'c', 'd']);
  assert.deepEqual(r.imports, ['./util.mjs', 'left-pad']);
});

test('JS: anonymous default export is reported as default', () => {
  const r = extractFile('a.js', 'export default { a: 1 };');
  assert.deepEqual(r.exports, ['default']);
});

test('Python: top-level def/class only, __all__ wins, imports resolved', () => {
  const src = `import json\nfrom dataclasses import dataclass\nfrom .core import parse, Report\nfrom . import core\n\ndef parse(t):\n    def inner(): pass\n    return t\n\nclass Report:\n    def render(self): pass\n\nasync def stream(): pass\n\ndef _private(): pass\n`;
  const r = extractFile('src/mypkg/cli.py', src);
  assert.deepEqual(r.exports, ['parse', 'Report', 'stream']);
  assert.deepEqual(r.imports, ['json', 'dataclasses', '.core', '.']);
  const r2 = extractFile('src/mypkg/__init__.py', `from .core import parse, Report\n__all__ = ["parse", "Report"]\ndef extra(): pass\n`);
  assert.deepEqual(r2.exports, ['parse', 'Report']);
});

test('Go and Rust: exported names only', () => {
  const go = extractFile('main.go', `package main\nfunc Run() {}\nfunc helper() {}\ntype Server struct{}\ntype inner struct{}\nfunc (s *Server) Start() {}\n`);
  assert.deepEqual(go.exports, ['Run', 'Server']);
  const rs = extractFile('src/lib.rs', `pub fn run() {}\nfn hidden() {}\npub struct Cfg;\npub enum Mode { A }\npub trait T {}\npub mod util;\npub(crate) fn semi() {}\n`);
  assert.deepEqual(rs.exports, ['run', 'Cfg', 'Mode', 'T', 'util']);
});

test('resolveImport maps specifiers to project files', () => {
  const files = new Set(['src/cli.mjs', 'src/scan.mjs', 'src/util/index.js', 'src/types.ts', 'lib/a.py', 'lib/pkg/__init__.py', 'lib/pkg/mod.py']);
  assert.equal(resolveImport('src/cli.mjs', './scan.mjs', files), 'src/scan.mjs');
  assert.equal(resolveImport('src/cli.mjs', './util', files), 'src/util/index.js');
  assert.equal(resolveImport('src/cli.mjs', './types', files), 'src/types.ts');
  assert.equal(resolveImport('src/cli.mjs', './types.js', files), 'src/types.ts', 'TS .js → .ts');
  assert.equal(resolveImport('src/cli.mjs', 'node:path', files), null);
  assert.equal(resolveImport('src/cli.mjs', 'left-pad', files), null);
  assert.equal(resolveImport('lib/pkg/mod.py', '.', files), 'lib/pkg/__init__.py');
  assert.equal(resolveImport('lib/pkg/mod.py', '..a', files), 'lib/a.py');
  assert.equal(resolveImport('lib/pkg/mod.py', 'lib.a', files), 'lib/a.py');
  assert.equal(resolveImport('lib/pkg/mod.py', 'pkg.mod', files), 'lib/pkg/mod.py', 'dotted path found under a source root');
  assert.equal(resolveImport('lib/pkg/mod.py', 'json', files), null);
});
