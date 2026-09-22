#!/usr/bin/env node
/**
 * startup-tax — what a Claude Code session spends finding its bearings.
 *
 *   node scripts/startup-tax.mjs ~/.claude/projects [--since 2026-09-01] [--format md|json] [--rates FILE] [--per-session]
 *
 * Reads Claude Code transcripts (.jsonl) and reports, per session and in aggregate:
 *   - exploratory tool calls before the first write (Read/Glob/Grep/LS + read-only shell)
 *   - how many of those are ORIENTATION calls — the ones a Bearings map answers
 *     (directory listings, manifests, README, rule files, git status/log, tool versions)
 *   - turns, tokens and dollars spent before the first write
 *   - orientation calls across the whole session, and what they kept reading
 *
 * Run it before installing the hook and again after ten sessions with it: the two medians are the number.
 * Zero dependencies. Never modifies anything. Rates are USD per million tokens, list price.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same card Glassbox uses (platform.claude.com pricing page, fetched 2026-09-05). Longest prefix wins.
export const RATES = {
  'claude-fable-5-1': { in: 10, out: 50, w5m: 12.5, w1h: 20, read: 0.25 },
  'claude-mythos-5-1': { in: 10, out: 50, w5m: 12.5, w1h: 20, read: 0.25 },
  'claude-fable-5': { in: 10, out: 50, w5m: 12.5, w1h: 20, read: 1.0 },
  'claude-mythos-5': { in: 10, out: 50, w5m: 12.5, w1h: 20, read: 1.0 },
  'claude-opus-5': { in: 5, out: 25, w5m: 6.25, w1h: 10, read: 0.5 },
  'claude-opus-4-8': { in: 5, out: 25, w5m: 6.25, w1h: 10, read: 0.5 },
  'claude-opus-4-7': { in: 5, out: 25, w5m: 6.25, w1h: 10, read: 0.5 },
  'claude-opus-4-6': { in: 5, out: 25, w5m: 6.25, w1h: 10, read: 0.5 },
  'claude-opus-4-5': { in: 5, out: 25, w5m: 6.25, w1h: 10, read: 0.5 },
  'claude-opus-4-1': { in: 15, out: 75, w5m: 18.75, w1h: 30, read: 1.5 },
  'claude-opus-4-2025': { in: 15, out: 75, w5m: 18.75, w1h: 30, read: 1.5 },
  'claude-sonnet-5': { in: 2, out: 10, w5m: 2.5, w1h: 4, read: 0.2 },
  'claude-sonnet-4': { in: 3, out: 15, w5m: 3.75, w1h: 6, read: 0.3 },
  'claude-haiku-4-5': { in: 1, out: 5, w5m: 1.25, w1h: 2, read: 0.1 },
  'claude-3-5-haiku': { in: 0.8, out: 4, w5m: 1.0, w1h: 1.6, read: 0.08 },
};

const MAP_TOKENS = 1500; // Bearings' default budget

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

const ORIENTATION_FILES = /(^|[\\/\s])(package\.json|pyproject\.toml|setup\.py|setup\.cfg|Cargo\.toml|go\.mod|composer\.json|Gemfile|Makefile|justfile|README(\.[a-z]+)?|CLAUDE(\.local)?\.md|AGENTS\.md|GEMINI\.md|CONTRIBUTING(\.md)?|\.editorconfig|tsconfig(\..*)?\.json|\.env\.example|\.gitignore|LICENSE|pnpm-workspace\.yaml|requirements\.txt|\.cursorrules)$/i;

const SHELL_WRITE = /(^|[;&|]\s*)(mkdir|touch|mv|cp|rm|rmdir|del|move|copy|ren|sed\s+-i|tee|git\s+(commit|add|push|checkout\s+-b|init|merge|rebase|stash|reset|tag)|npm\s+(install|i|add|uninstall|publish|ci|init)|pnpm\s+(install|add|i)|yarn\s+(add|install)|pip\s+install|uv\s+(add|pip\s+install|init)|cargo\s+(add|new|init)|go\s+(get|mod\s+init)|Set-Content|Out-File|Add-Content|New-Item|Copy-Item|Move-Item|Remove-Item|curl\s+.*-o\b|wget\s|zip\s|unzip\s|tar\s+-?x|python[3]?\s+-c\s+.*open\(.*['"]w|node\s+-e\s+.*writeFile)/i;
const SHELL_REDIRECT = /(^|[^0-9&>])>{1,2}\s*(?!&)[^\s&|;]/; // `> file`, not `2>&1`
const SHELL_READONLY = /^\s*(cd\s+[^;&|]+\s*(&&|;)\s*)?(ls|dir|tree|pwd|cat|head|tail|less|more|type|wc|find|fd|rg|grep|ag|stat|file|du|df|which|where|whereis|echo\s+\$|env|printenv|git\s+(status|log|branch|remote|diff|show|rev-parse|ls-files|describe)|node\s+(-v|--version)|npm\s+(-v|--version|ls|list|run\s*$|view)|python[3]?\s+(-V|--version)|pip\s+(list|show|freeze)|uv\s+pip\s+list|cargo\s+(--version|tree)|go\s+(version|env|list)|Get-ChildItem|Get-Content|Get-Location|Get-Command|Select-String|Test-Path)\b/i;
const SHELL_ORIENTATION = /^\s*(cd\s+[^;&|]+\s*(&&|;)\s*)?(ls|dir|tree|pwd|Get-ChildItem|Get-Location|git\s+(status|log|branch|remote|rev-parse|ls-files|describe)|npm\s+(ls|list|run\s*$)|pip\s+(list|freeze)|uv\s+pip\s+list|find\s+\S+\s+(-maxdepth|-type|-name)|Test-Path)\b/i;

function shellCommand(input) { return String(input?.command ?? '').trim(); }

/** Normalise a path for comparison: forward slashes, lower case, `/c/x` → `c:/x`. */
function normPath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/^"|"$/g, '').toLowerCase();
}

/** True when every absolute path mentioned sits under the project (or there are none). Orientation outside the project is not the map's business. */
function insideProject(text, cwd) {
  if (!cwd) return true;
  const root = normPath(cwd).replace(/\/$/, '');
  const abs = String(text).match(/(?:[A-Za-z]:\\|[A-Za-z]:\/|\/[a-z]\/|\/(?:c|home|tmp|usr|etc|mnt|var|opt)\/|\$HOME|~\/|%USERPROFILE%)[^\s"';&|)]*/g) || [];
  for (const a of abs) {
    const n = normPath(a.replace(/^\$HOME|^~|^%USERPROFILE%/i, root.replace(/^([a-z]):\/users\/[^/]+.*/, '$&').split('/').slice(0, 3).join('/')));
    if (!n.startsWith(root)) return false;
  }
  return true;
}

const TOOLCHAIN_CHECK = /^\s*(which|where|whereis)\s+(node|npm|pnpm|yarn|bun|python[3]?|pip[3]?|uv|poetry|cargo|rustc|go|java|dotnet|ruby|php|git)\b|^\s*(node|npm|pnpm|yarn|bun|python[3]?|pip[3]?|uv|cargo|rustc|go|java|dotnet|ruby|php)\s+(-v|-V|--version|version)\b/i;

/** 'write' | 'orientation' | 'exploratory' | 'other'. `cwd` scopes orientation to the project. */
export function classify(name, input, cwd = null) {
  if (WRITE_TOOLS.has(name)) return 'write';
  if (name === 'Read') {
    const fp = String(input?.file_path ?? '');
    return ORIENTATION_FILES.test(fp) && insideProject(fp, cwd) ? 'orientation' : 'exploratory';
  }
  if (name === 'Glob' || name === 'LS') return insideProject(input?.path ?? '', cwd) ? 'orientation' : 'exploratory';
  if (name === 'Grep') return 'exploratory';
  if (SHELL_TOOLS.has(name)) {
    const cmd = shellCommand(input);
    if (!cmd) return 'other';
    if (SHELL_WRITE.test(cmd) || SHELL_REDIRECT.test(cmd)) return 'write';
    if (TOOLCHAIN_CHECK.test(cmd)) return 'orientation';
    if (/^\s*(which|where|whereis)\s/i.test(cmd) || /\s(-v|-V|--version)\b/.test(cmd)) return 'exploratory';
    if (SHELL_ORIENTATION.test(cmd)) return insideProject(cmd, cwd) ? 'orientation' : 'exploratory';
    if (/^\s*(cat|head|type|Get-Content)\s+/i.test(cmd) && ORIENTATION_FILES.test(cmd)) return insideProject(cmd, cwd) ? 'orientation' : 'exploratory';
    if (SHELL_READONLY.test(cmd)) return 'exploratory';
    return 'other';
  }
  return 'other';
}

/** What an orientation call was looking at, for the "kept reading" table. */
function target(name, input) {
  if (name === 'Read') return path.basename(String(input?.file_path ?? '').replace(/\\/g, '/'));
  if (name === 'Glob') return `Glob ${input?.pattern ?? ''}`.trim();
  if (name === 'LS') return 'LS';
  const cmd = shellCommand(input).replace(/^cd\s+[^;&|]+\s*(&&|;)\s*/, '');
  const m = cmd.match(/^(git\s+\w+|[A-Za-z][\w-]*)/);
  const head = m ? m[1] : cmd.slice(0, 12);
  if (/^(cat|head|type|Get-Content)$/i.test(head)) { const f = cmd.match(ORIENTATION_FILES); return f ? f[0].replace(/^[\\/]/, '') : head; }
  return head;
}

function rateFor(model, rates) {
  let best = null;
  for (const k of Object.keys(rates)) if (model && model.startsWith(k) && (!best || k.length > best.length)) best = k;
  return best ? rates[best] : null;
}

function turnCost(usage, model, rates) {
  const r = rateFor(model, rates);
  if (!r) return null;
  const w1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const w5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (usage.cache_creation_input_tokens || 0) - w1h);
  return ((usage.input_tokens || 0) * r.in + w5m * r.w5m + w1h * r.w1h + (usage.cache_read_input_tokens || 0) * r.read + (usage.output_tokens || 0) * r.out) / 1e6;
}

/** Parse one transcript. Returns null for non-session files (subagents, empty). */
export async function analyseFile(file, { rates = RATES } = {}) {
  const text = await fs.readFile(file, 'utf8');
  const turns = new Map(); // requestId → { index, model, usage(max per field), tools: [] }
  const results = new Map(); // tool_use_id → result chars
  let cwd = null, first = null, sessionId = null, sidechain = false;
  const order = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.isSidechain) sidechain = true;
    if (r.type === 'user') {
      cwd ??= r.cwd || null;
      first ??= r.timestamp || null;
      sessionId ??= r.sessionId || null;
      const c = r.message?.content;
      if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_result') {
        const body = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x?.text || '').join('') : '';
        results.set(b.tool_use_id, body.length);
      }
    }
    if (r.type !== 'assistant') continue;
    const m = r.message || {};
    const id = r.requestId || r.uuid;
    if (!turns.has(id)) { turns.set(id, { index: order.length, model: m.model || null, usage: {}, tools: [], timestamp: r.timestamp }); order.push(id); }
    const t = turns.get(id);
    const u = m.usage || {};
    for (const k of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']) t.usage[k] = Math.max(t.usage[k] || 0, u[k] || 0);
    if (u.cache_creation) {
      t.usage.cache_creation ??= {};
      for (const k of ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']) t.usage.cache_creation[k] = Math.max(t.usage.cache_creation[k] || 0, u.cache_creation[k] || 0);
    }
    if (Array.isArray(m.content)) for (const b of m.content) if (b?.type === 'tool_use') t.tools.push({ id: b.id, name: b.name, input: b.input, kind: classify(b.name, b.input, cwd) });
  }
  if (!order.length) return null;
  const calls = [];
  order.forEach((id, i) => { for (const tool of turns.get(id).tools) calls.push({ ...tool, turn: i, resultChars: results.get(tool.id) || 0 }); });
  const firstWriteIdx = calls.findIndex((c) => c.kind === 'write');
  const before = firstWriteIdx >= 0 ? calls.slice(0, firstWriteIdx) : null;
  const writeTurn = firstWriteIdx >= 0 ? calls[firstWriteIdx].turn : null;
  let tokensBefore = 0, costBefore = 0, costTotal = 0, tokensTotal = 0, costKnown = true;
  order.forEach((id, i) => {
    const t = turns.get(id);
    const tok = (t.usage.input_tokens || 0) + (t.usage.cache_creation_input_tokens || 0) + (t.usage.cache_read_input_tokens || 0) + (t.usage.output_tokens || 0);
    const c = turnCost(t.usage, t.model, rates);
    if (c === null) costKnown = false;
    tokensTotal += tok; costTotal += c || 0;
    if (writeTurn !== null && i < writeTurn) { tokensBefore += tok; costBefore += c || 0; }
  });
  const orientationAll = calls.filter((c) => c.kind === 'orientation');
  const targets = {};
  for (const c of orientationAll) { const k = target(c.name, c.input); targets[k] = (targets[k] || 0) + 1; }
  // Turns whose tool calls were ALL orientation: the round-trips the map removes outright.
  let orientationOnlyTurns = 0, orientationTurnTokens = 0, orientationTurnCost = 0;
  for (const id of order) {
    const t = turns.get(id);
    if (!t.tools.length || !t.tools.every((x) => x.kind === 'orientation')) continue;
    orientationOnlyTurns++;
    orientationTurnTokens += (t.usage.input_tokens || 0) + (t.usage.cache_creation_input_tokens || 0) + (t.usage.cache_read_input_tokens || 0) + (t.usage.output_tokens || 0);
    orientationTurnCost += turnCost(t.usage, t.model, rates) || 0;
  }
  // What carrying a 1,500-token map would have cost this session: written to cache once, read back every turn.
  const r0 = rateFor(turns.get(order[0]).model, rates);
  const carryCost = r0 ? (MAP_TOKENS * r0.w5m + MAP_TOKENS * order.length * r0.read) / 1e6 : null;
  return {
    file, sessionId, cwd, project: cwd ? path.basename(cwd.replace(/\\/g, '/')) : null, started: first, sidechain,
    model: turns.get(order[0]).model, turns: order.length, toolCalls: calls.length,
    tokensTotal, costTotal: costKnown ? costTotal : null,
    startup: before ? {
      exploratory: before.filter((c) => c.kind === 'exploratory' || c.kind === 'orientation').length,
      orientation: before.filter((c) => c.kind === 'orientation').length,
      other: before.filter((c) => c.kind === 'other').length,
      turnsToFirstWrite: writeTurn, tokensBefore, costBefore: costKnown ? costBefore : null,
      resultCharsBefore: before.reduce((n, c) => n + c.resultChars, 0),
    } : null,
    orientation: { calls: orientationAll.length, resultChars: orientationAll.reduce((n, c) => n + c.resultChars, 0), turnsOnly: orientationOnlyTurns, turnsOnlyTokens: orientationTurnTokens, turnsOnlyCost: costKnown ? orientationTurnCost : null, targets },
    carryCost,
  };
}

export async function findTranscripts(dir) {
  const out = [];
  const st = await fs.stat(dir);
  if (st.isFile()) return [dir];
  async function walk(d, depth) {
    let ents;
    try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'subagents' && e.name !== 'tool-results' && e.name !== 'workflows' && e.name !== 'memory' && depth < 3) await walk(p, depth + 1); }
      else if (e.isFile() && e.name.endsWith('.jsonl') && !e.name.startsWith('agent-') && e.name !== 'journal.jsonl') out.push(p);
    }
  }
  await walk(dir, 0);
  return out.sort();
}

const median = (xs) => { const a = xs.filter((x) => x !== null && x !== undefined).sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const mean = (xs) => { const a = xs.filter((x) => x !== null && x !== undefined); return a.length ? a.reduce((p, q) => p + q, 0) / a.length : null; };
const sum = (xs) => xs.filter((x) => x !== null && x !== undefined).reduce((p, q) => p + q, 0);
const money = (x) => (x === null || x === undefined ? 'n/a' : `$${x.toFixed(2)}`);
const n0 = (x) => (x === null || x === undefined ? 'n/a' : Math.round(x).toLocaleString('en-US'));
const n1 = (x) => (x === null || x === undefined ? 'n/a' : (Math.round(x * 10) / 10).toString());

export function aggregate(sessions) {
  const withWrite = sessions.filter((s) => s.startup);
  const S = (k) => withWrite.map((s) => s.startup[k]);
  const targets = {};
  for (const s of sessions) for (const [k, v] of Object.entries(s.orientation.targets)) targets[k] = (targets[k] || 0) + v;
  const topTargets = Object.entries(targets).sort((a, b) => b[1] - a[1]).slice(0, 15);
  return {
    sessions: sessions.length, withWrite: withWrite.length,
    startup: {
      exploratory: { median: median(S('exploratory')), mean: mean(S('exploratory')), total: sum(S('exploratory')) },
      orientation: { median: median(S('orientation')), mean: mean(S('orientation')), total: sum(S('orientation')) },
      turnsToFirstWrite: { median: median(S('turnsToFirstWrite')), mean: mean(S('turnsToFirstWrite')) },
      tokensBefore: { median: median(S('tokensBefore')), mean: mean(S('tokensBefore')), total: sum(S('tokensBefore')) },
      costBefore: { median: median(S('costBefore')), mean: mean(S('costBefore')), total: sum(S('costBefore')) },
      orientationShare: sum(S('exploratory')) ? sum(S('orientation')) / sum(S('exploratory')) : null,
    },
    orientation: {
      calls: sum(sessions.map((s) => s.orientation.calls)),
      perSession: { median: median(sessions.map((s) => s.orientation.calls)), mean: mean(sessions.map((s) => s.orientation.calls)) },
      resultTokens: Math.round(sum(sessions.map((s) => s.orientation.resultChars)) / 3.5),
      turnsOnly: sum(sessions.map((s) => s.orientation.turnsOnly)),
      turnsOnlyTokens: sum(sessions.map((s) => s.orientation.turnsOnlyTokens)),
      turnsOnlyCost: sessions.every((s) => s.orientation.turnsOnlyCost !== null) ? sum(sessions.map((s) => s.orientation.turnsOnlyCost)) : null,
      topTargets,
    },
    carryCost: sessions.every((s) => s.carryCost !== null) ? sum(sessions.map((s) => s.carryCost)) : null,
    turnsTotal: sum(sessions.map((s) => s.turns)),
    costTotal: sessions.every((s) => s.costTotal !== null) ? sum(sessions.map((s) => s.costTotal)) : null,
    tokensTotal: sum(sessions.map((s) => s.tokensTotal)),
    projects: [...new Set(sessions.map((s) => s.project).filter(Boolean))],
  };
}

export function renderMarkdown(agg, sessions, { perSession = false, title = 'Startup tax' } = {}) {
  const a = agg.startup, o = agg.orientation;
  const L = [];
  L.push(`# ${title}`, '');
  L.push(`${agg.sessions} sessions across ${agg.projects.length} project${agg.projects.length === 1 ? '' : 's'} (${agg.projects.join(', ')}) · ${n0(agg.turnsTotal)} turns · ${n0(agg.tokensTotal)} tokens · ${money(agg.costTotal)} at list price (main thread only; subagents excluded) · ${agg.withWrite} sessions reached a first write.`, '');
  L.push('## Before the first write (per session that wrote)', '');
  L.push('| metric | median | mean | total |', '|---|---|---|---|');
  L.push(`| exploratory calls | ${n1(a.exploratory.median)} | ${n1(a.exploratory.mean)} | ${n0(a.exploratory.total)} |`);
  L.push(`| of which orientation (map-answerable) | ${n1(a.orientation.median)} | ${n1(a.orientation.mean)} | ${n0(a.orientation.total)} |`);
  L.push(`| turns to first write | ${n1(a.turnsToFirstWrite.median)} | ${n1(a.turnsToFirstWrite.mean)} | — |`);
  L.push(`| tokens before first write | ${n0(a.tokensBefore.median)} | ${n0(a.tokensBefore.mean)} | ${n0(a.tokensBefore.total)} |`);
  L.push(`| cost before first write | ${money(a.costBefore.median)} | ${money(a.costBefore.mean)} | ${money(a.costBefore.total)} |`);
  L.push('', `Orientation share of exploratory calls before the first write: **${a.orientationShare === null ? 'n/a' : Math.round(a.orientationShare * 100) + '%'}**.`, '');
  L.push('## Orientation calls, whole sessions', '');
  L.push(`${n0(o.calls)} calls (median ${n1(o.perSession.median)} per session, mean ${n1(o.perSession.mean)}) returning about ${n0(o.resultTokens)} tokens of listings and manifests into context.`, '');
  L.push(`**${n0(o.turnsOnly)} of ${n0(agg.turnsTotal)} turns did nothing but orient** — ${n0(o.turnsOnlyTokens)} tokens, ${money(o.turnsOnlyCost)}. Those are the round-trips a map in context removes outright.`, '');
  L.push(`Carrying a ${MAP_TOKENS.toLocaleString('en-US')}-token map through every one of these sessions (written to cache once, read back on each turn) would have cost about ${money(agg.carryCost)}. Net: **${agg.carryCost !== null && o.turnsOnlyCost !== null ? money(o.turnsOnlyCost - agg.carryCost) : 'n/a'}** across ${agg.sessions} sessions, before counting the calls that partly overlap with orientation or the turns that came after.`, '');
  L.push('What kept getting read:', '');
  L.push('| target | calls |', '|---|---|');
  for (const [k, v] of o.topTargets) L.push(`| ${k.replace(/\|/g, '\\|')} | ${v} |`);
  L.push('');
  if (perSession) {
    L.push('## Per session', '', '| project | started | turns | expl. before write | orientation | turns to write | $ before write | $ total |', '|---|---|---|---|---|---|---|---|');
    for (const s of sessions) {
      const st = s.startup;
      L.push(`| ${s.project || '?'} | ${(s.started || '').slice(0, 10)} | ${s.turns} | ${st ? st.exploratory : '—'} | ${st ? st.orientation : '—'} | ${st ? st.turnsToFirstWrite : 'no write'} | ${st ? money(st.costBefore) : '—'} | ${money(s.costTotal)} |`);
    }
    L.push('');
  }
  L.push('Definitions: a *write* is Edit/Write/MultiEdit/NotebookEdit or a shell command that creates, moves, installs or commits. *Exploratory* is Read/Glob/Grep/LS plus read-only shell. *Orientation* is the subset a Bearings map answers: directory listings, manifests, README, rule files, git status/log, tool versions. Costs use list price per million tokens; a streamed turn counts once (max per usage field).');
  return L.join('\n') + '\n';
}

async function main(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = ['since', 'format', 'rates', 'title'].includes(k) ? argv[++i] : true; args.flags[k] = v; }
    else args._.push(a);
  }
  const dir = args._[0] || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.claude', 'projects');
  const rates = args.flags.rates ? { ...RATES, ...JSON.parse(await fs.readFile(args.flags.rates, 'utf8')) } : RATES;
  const files = await findTranscripts(dir);
  const since = args.flags.since ? new Date(args.flags.since).getTime() : 0;
  const sessions = [];
  for (const f of files) {
    const s = await analyseFile(f, { rates });
    if (!s || s.sidechain || !s.toolCalls) continue;
    if (since && s.started && new Date(s.started).getTime() < since) continue;
    sessions.push(s);
  }
  if (!sessions.length) { process.stderr.write(`no sessions with tool calls under ${dir}\n`); return 1; }
  const agg = aggregate(sessions);
  if (args.flags.format === 'json') process.stdout.write(JSON.stringify({ aggregate: agg, sessions }, null, 2) + '\n');
  else process.stdout.write(renderMarkdown(agg, sessions, { perSession: !!args.flags['per-session'], title: args.flags.title || 'Startup tax' }));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
