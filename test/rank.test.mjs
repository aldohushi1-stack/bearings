import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankModules } from '../src/rank.mjs';
import { estimateTokens } from '../src/tokens.mjs';

const mod = (path, exports = ['x']) => ({ path, exports, imports: [] });

test('entry points first, importedBy boosts, tests and config sink', () => {
  const modules = [
    mod('src/util.mjs'), mod('src/cli.mjs'), mod('src/index.mjs'), mod('test/a.test.mjs'),
    mod('eslint.config.js'), mod('src/deep/er/thing.mjs'),
  ];
  const importedBy = new Map([['src/util.mjs', 3], ['src/cli.mjs', 1]]);
  const ranked = rankModules(modules, { entries: ['src/index.mjs'], importedBy });
  assert.equal(ranked[0].path, 'src/index.mjs');
  assert.equal(ranked[1].path, 'src/util.mjs');
  assert.equal(ranked[2].path, 'src/cli.mjs');
  assert.equal(ranked.at(-1).path, 'test/a.test.mjs', 'tests last');
  assert.ok(ranked.findIndex((r) => r.path === 'eslint.config.js') > ranked.findIndex((r) => r.path === 'src/deep/er/thing.mjs'));
  assert.ok(ranked.every((r) => typeof r.score === 'number'));
});

test('ties break by path so ranking is deterministic', () => {
  const a = rankModules([mod('b.js'), mod('a.js'), mod('c.js')], { entries: [], importedBy: new Map() });
  assert.deepEqual(a.map((r) => r.path), ['a.js', 'b.js', 'c.js']);
});

test('estimateTokens is pessimistic and monotonic', () => {
  assert.equal(estimateTokens(''), 0);
  const short = estimateTokens('hello world');
  const long = estimateTokens('hello world '.repeat(100));
  assert.ok(long > short);
  // 1000 chars of prose is ~250 real tokens; we must estimate more than that.
  assert.ok(estimateTokens('a'.repeat(1000)) >= 250);
});
