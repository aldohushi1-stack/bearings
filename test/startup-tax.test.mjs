import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { classify, analyseFile, aggregate, renderMarkdown, findTranscripts } from '../scripts/startup-tax.mjs';
import { tempDir, writeTree, rm } from './helpers.mjs';

test('classify: writes, orientation, exploratory, other', () => {
  assert.equal(classify('Edit', {}), 'write');
  assert.equal(classify('Write', {}), 'write');
  assert.equal(classify('Bash', { command: 'mkdir -p src && touch src/a.js' }), 'write');
  assert.equal(classify('Bash', { command: 'echo hi > out.txt' }), 'write');
  assert.equal(classify('Bash', { command: 'git commit -m x' }), 'write');
  assert.equal(classify('Bash', { command: 'npm test 2>&1 | tail -5' }), 'other', '2>&1 is not a redirect to a file');
  assert.equal(classify('Bash', { command: 'ls -la /c/Users/Aldo/my-agent' }), 'orientation');
  assert.equal(classify('Bash', { command: 'cd /c/x && git status' }), 'orientation');
  assert.equal(classify('PowerShell', { command: 'Get-ChildItem -Recurse' }), 'orientation');
  assert.equal(classify('Bash', { command: 'cat package.json' }), 'orientation');
  assert.equal(classify('Bash', { command: 'cat src/index.js' }), 'exploratory');
  assert.equal(classify('Read', { file_path: 'C:\\x\\README.md' }), 'orientation');
  assert.equal(classify('Read', { file_path: 'C:\\x\\src\\a.py' }), 'exploratory');
  assert.equal(classify('Glob', { pattern: '**/*.js' }), 'orientation');
  assert.equal(classify('Grep', { pattern: 'main' }), 'exploratory');
  assert.equal(classify('WebSearch', { query: 'x' }), 'other');
  assert.equal(classify('Bash', { command: 'node --version' }), 'orientation');
  assert.equal(classify('Bash', { command: 'pytest -q' }), 'other');
  // Scoped to the project: listing somewhere else is exploration, not orientation.
  const cwd = 'C:\\Users\\Aldo\\my-agent';
  assert.equal(classify('Bash', { command: 'ls -la /c/Users/Aldo/my-agent/backtalk' }, cwd), 'orientation');
  assert.equal(classify('Bash', { command: 'cd /c/Users/Aldo/my-agent && ls' }, cwd), 'orientation');
  assert.equal(classify('Bash', { command: 'ls -la' }, cwd), 'orientation', 'relative = inside');
  assert.equal(classify('Bash', { command: 'ls "/c/Program Files/LibreOffice/program/"' }, cwd), 'exploratory');
  assert.equal(classify('PowerShell', { command: 'Get-ChildItem -Path "C:\\Users\\Aldo" -Directory -Recurse' }, cwd), 'exploratory');
  assert.equal(classify('Read', { file_path: 'C:\\Users\\Aldo\\Desktop\\sesh\\x\\README.md' }, cwd), 'exploratory');
  assert.equal(classify('Read', { file_path: 'C:\\Users\\Aldo\\my-agent\\README.md' }, cwd), 'orientation');
  assert.equal(classify('Bash', { command: 'which soffice' }, cwd), 'exploratory', 'not a toolchain the map names');
  assert.equal(classify('Bash', { command: 'which python python3 py' }, cwd), 'orientation');
});

function rec(type, extra) { return JSON.stringify({ type, sessionId: 's1', cwd: 'C:\\Users\\Aldo\\demo', timestamp: '2026-09-22T10:00:00Z', ...extra }); }
function assistant(requestId, content, usage, model = 'claude-sonnet-5') {
  return rec('assistant', { requestId, message: { model, content, usage } });
}
const U = (input, cw, cr, out) => ({ input_tokens: input, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out });

test('analyseFile: startup tax, orientation-only turns, streamed usage counted once', async () => {
  const dir = await tempDir();
  const lines = [
    rec('user', { message: { role: 'user', content: 'fix the bug' } }),
    // turn 1: ls (orientation only) — streamed as two records with the same requestId; usage must count once
    assistant('r1', [{ type: 'text', text: 'Looking' }], U(100, 10000, 0, 10)),
    assistant('r1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } }], U(100, 10000, 0, 30)),
    rec('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.js\nb.js\n' }] } }),
    // turn 2: read a source file (exploratory)
    assistant('r2', [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'C:\\Users\\Aldo\\demo\\a.js' } }], U(50, 0, 10100, 20)),
    rec('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'x'.repeat(350) }] } }),
    // turn 3: the first write
    assistant('r3', [{ type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: 'a.js' } }], U(50, 0, 10200, 40)),
    rec('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }] } }),
    // turn 4: another ls after the write (orientation only, counted in whole-session totals)
    assistant('r4', [{ type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'ls src' } }], U(50, 0, 10300, 10)),
    rec('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't4', content: 'c.js' }] } }),
  ];
  await writeTree(dir, { 'proj/s1.jsonl': lines.join('\n') + '\n', 'proj/subagents/agent-x.jsonl': lines[1] + '\n' });
  const files = await findTranscripts(dir);
  assert.deepEqual(files.map((f) => path.basename(f)), ['s1.jsonl'], 'subagents are not sessions');
  const s = await analyseFile(files[0]);
  assert.equal(s.project, 'demo');
  assert.equal(s.turns, 4);
  assert.equal(s.toolCalls, 4);
  assert.deepEqual([s.startup.exploratory, s.startup.orientation, s.startup.turnsToFirstWrite], [2, 1, 2]);
  // turn 1 usage counted once: 100 + 10000 + 0 + 30 = 10130; turn 2: 50+10100+20 = 10170
  assert.equal(s.startup.tokensBefore, 10130 + 10170);
  // sonnet-5: in 2, w5m 2.5, read 0.2, out 10 per million
  const t1 = (100 * 2 + 10000 * 2.5 + 30 * 10) / 1e6;
  const t2 = (50 * 2 + 10100 * 0.2 + 20 * 10) / 1e6;
  assert.ok(Math.abs(s.startup.costBefore - (t1 + t2)) < 1e-9);
  assert.equal(s.orientation.calls, 2);
  assert.equal(s.orientation.turnsOnly, 2);
  assert.deepEqual(s.orientation.targets, { ls: 2 });
  assert.ok(s.carryCost > 0);
  const agg = aggregate([s]);
  assert.equal(agg.withWrite, 1);
  assert.equal(agg.startup.orientation.median, 1);
  const md = renderMarkdown(agg, [s], { perSession: true });
  assert.ok(md.includes('did nothing but orient'));
  assert.ok(md.includes('| demo |'));
  await rm(dir);
});

test('analyseFile: a session with no write reports startup as null but still counts orientation', async () => {
  const dir = await tempDir();
  const lines = [
    rec('user', { message: { role: 'user', content: 'what is here?' } }),
    assistant('r1', [{ type: 'tool_use', id: 't1', name: 'Glob', input: { pattern: '**/*' } }], U(10, 0, 0, 5)),
    rec('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a' }] } }),
    assistant('r2', [{ type: 'text', text: 'Just a.' }], U(10, 0, 0, 5)),
  ];
  await writeTree(dir, { 's2.jsonl': lines.join('\n') + '\n' });
  const s = await analyseFile(path.join(dir, 's2.jsonl'));
  assert.equal(s.startup, null);
  assert.equal(s.orientation.calls, 1);
  const agg = aggregate([s]);
  assert.equal(agg.withWrite, 0);
  assert.equal(agg.startup.exploratory.median, null);
  assert.ok(renderMarkdown(agg, [s]).includes('n/a'));
  await rm(dir);
});
