import { estimateTokens } from './tokens.mjs';

const KIND_LABEL = {
  'node-cli': 'Node CLI', 'node-web': 'Node web app', 'node-server': 'Node server', 'node-library': 'Node library',
  'python-package': 'Python package', 'python-scripts': 'Python scripts', rust: 'Rust crate', go: 'Go module',
  'static-site': 'static site', 'single-file-web': 'single-file web page(s)', docs: 'docs folder',
  monorepo: 'monorepo', 'folder-of-projects': 'folder of projects', mixed: 'mixed folder', empty: 'empty folder',
};

const joinList = (items, max, more = 'more') => {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} +${items.length - max} ${more}`;
};

function identity(m, o) {
  const lines = [`# ${m.name}`];
  const desc = o.shortDescription && m.description ? m.description.split(/(?<=[.!?])\s+/)[0] : m.description;
  if (desc) lines.push('', desc);
  const bits = [`**Kind:** ${m.kind}${KIND_LABEL[m.kind] && KIND_LABEL[m.kind] !== m.kind ? ` (${KIND_LABEL[m.kind]})` : ''}`];
  if (m.languages.length) bits.push(`**Languages:** ${m.languages.slice(0, 4).map((l) => `${l.name} (${l.files})`).join(', ')}`);
  if (m.packageManager) bits.push(`**Package manager:** ${m.packageManager}`);
  if (m.moduleSystem) bits.push(`**Modules:** ${m.moduleSystem.toUpperCase()}`);
  if (m.license) bits.push(`**License:** ${m.license}`);
  if (m.gitBranch) bits.push(`**Branch:** ${m.gitBranch}`);
  bits.push(`**Files:** ${m.fileCount}${m.truncated ? '+' : ''}`);
  lines.push('', bits.join(' · '));
  return lines.join('\n');
}

function runAndTest(m, o) {
  const lines = ['## Run & test'];
  const max = o.truncateRun ? 5 : 40;
  const scripts = m.scripts.slice(0, max);
  for (const s of scripts) lines.push(`- \`${s.invoke}\`${s.cmd && s.cmd !== s.invoke ? ` — ${s.cmd.length > 90 ? s.cmd.slice(0, 87) + '…' : s.cmd}` : ''}`);
  if (m.scripts.length > max) lines.push(`- +${m.scripts.length - max} more scripts`);
  const facts = [];
  if (m.test.runner) facts.push(`Tests: ${m.test.runner}${m.test.dir ? ` in ${m.test.dir}/` : ''}${m.test.extra.length ? ` (+${m.test.extra.join(', ')})` : ''}`);
  else if (m.test.dir) facts.push(`Tests: ${m.test.dir}/ (runner not detected)`);
  else if (!['docs', 'empty', 'folder-of-projects', 'single-file-web', 'static-site'].includes(m.kind)) facts.push('Tests: none found');
  if (m.lint.length) facts.push(`Lint/format: ${m.lint.join(', ')}`);
  if (m.ci.length) facts.push(`CI: ${joinList(m.ci, 5)}`);
  if (m.docker.length) facts.push(`Docker: ${m.docker.join(', ')}`);
  if (facts.length) lines.push(`- ${facts.join(' · ')}`);
  return lines.length > 1 ? lines.join('\n') : null;
}

function entryPoints(m) {
  if (!m.entryLabels.length) return null;
  return ['## Entry points', ...m.entryLabels.slice(0, 12).map((e) => `- ${e.path}${e.label && e.label !== 'entry' ? ` (${e.label})` : ''}`)].join('\n');
}

function rulesSection(m) {
  const r = m.rules;
  const found = [];
  if (r.claudeMd) found.push('CLAUDE.md');
  if (r.claudeRules) found.push(`.claude/rules/ (${r.claudeRules})`);
  if (r.agentsMd) found.push('AGENTS.md');
  if (r.geminiMd) found.push('GEMINI.md');
  if (r.cursorRules) found.push('Cursor rules');
  if (r.copilot) found.push('copilot-instructions.md');
  if (r.contributing) found.push(r.contributing);
  const lines = ['## Rules'];
  if (found.length) lines.push(`- Read first: ${found.join(', ')}`);
  const conv = [];
  if (r.indent) conv.push(`Indent: ${r.indent}`);
  if (r.tsStrict === true) conv.push('TypeScript strict');
  if (r.precommit) conv.push('pre-commit hooks');
  if (r.codeowners) conv.push('CODEOWNERS');
  if (m.envKeys.length) conv.push(`${m.envExample} keys: ${joinList(m.envKeys, 12)}`);
  if (m.envPresent) conv.push('.env present (not read)');
  if (m.envFileCount > (m.envPresent ? 1 : 0)) conv.push(`${m.envFileCount} .env file${m.envFileCount === 1 ? "" : "s"} in the tree (not read)`);
  if (m.sensitiveCount) conv.push(`${m.sensitiveCount} credential-looking file${m.sensitiveCount > 1 ? 's' : ''} (not listed)`);
  if (conv.length) lines.push(`- ${conv.join(' · ')}`);
  return lines.length > 1 ? lines.join('\n') : null;
}

function projects(m) {
  if (!m.subprojects.length) return null;
  const lines = [m.kind === 'monorepo' ? '## Packages' : '## Projects'];
  const one = (p) => {
    const bits = [p.kind, p.name && p.name !== p.path.split('/').pop() ? p.name : null, p.description ? (p.description.length > 80 ? p.description.slice(0, 77) + '…' : p.description) : null].filter(Boolean);
    return `- ${p.path}/${bits.length ? ` — ${bits.join(' · ')}` : ''} (${p.files} files)`;
  };
  if (m.projectGroups?.length) {
    const groups = m.projectGroups.slice(0, 6);
    for (const g of groups) {
      if (!g.parent) { for (const p of g.packages.slice(0, 12)) lines.push(one(p)); continue; }
      const names = g.packages.slice(0, 8).map((p) => `${p.path.slice(g.parent.length + 1)} (${p.files})`);
      lines.push(`- ${g.parent}/ — ${g.packages.length} package${g.packages.length === 1 ? '' : 's'}: ${names.join(', ')}${g.packages.length > 8 ? `, +${g.packages.length - 8} more` : ''}`);
    }
    if (m.projectGroups.length > 6) lines.push(`- +${m.projectGroups.length - 6} more package folders`);
    return lines.join('\n');
  }
  for (const p of m.subprojects.slice(0, 40)) lines.push(one(p));
  if (m.subprojects.length > 40) lines.push(`- +${m.subprojects.length - 40} more`);
  return lines.join('\n');
}

function layout(m, o) {
  const L = m.layout;
  if (!L.dirs.length && !L.rootFiles) return null;
  const lines = ['## Layout'];
  const maxDirs = o.truncateLayout ? 10 : 30;
  const dirs = L.dirs.slice(0, maxDirs);
  const deepFor = o.shallowLayout ? new Set() : new Set(dirs.slice(0, 3).filter((d) => d.children.length >= 1 && d.files >= 4).map((d) => d.name));
  for (const d of dirs) {
    const bits = [d.files ? `${d.files} file${d.files === 1 ? '' : 's'}` : 'empty'];
    if (d.ext) bits.push(d.ext);
    if (d.label) bits.push(d.label);
    lines.push(`- ${d.name}/ — ${bits.join(' · ')}`);
    if (deepFor.has(d.name)) {
      const inKids = d.children.reduce((n, c) => n + c.files, 0);
      const kids = d.children.slice(0, 6).map((c) => `${c.name}/ (${c.files})`);
      const direct = d.files - inKids;
      lines.push(`  - ${kids.join(', ')}${d.children.length > 6 ? `, +${d.children.length - 6} more` : ''}${direct > 0 ? ` · ${direct} file${direct === 1 ? '' : 's'} directly` : ''}`);
    }
  }
  if (L.dirs.length > maxDirs) lines.push(`- +${L.dirs.length - maxDirs} more directories`);
  if (L.rootFiles) lines.push(`- ${L.rootFiles} file${L.rootFiles === 1 ? '' : 's'} at the root`);
  const skippedBits = [];
  if (m.skipped.length) skippedBits.push(m.skipped.join(', '));
  if (m.skippedNested?.length) skippedBits.push(`nested ${m.skippedNested.join(', ')}`);
  if (skippedBits.length) lines.push(`- Skipped: ${skippedBits.join(' · ')}`);
  return lines.join('\n');
}

function modules(m, o) {
  if (!m.modules || !m.modules.length) return null;
  const budgetChars = o.moduleChars ?? Infinity;
  const lines = ['## Modules'];
  let used = 0;
  let shown = 0;
  let noise = 0;
  for (const mod of m.modules) {
    const isNoise = mod.isTest || mod.isExample;
    // Ranking sinks tests, examples and docs to the bottom; once the product modules are listed, stop.
    if (isNoise) { if (shown >= 5 || noise >= 3) continue; noise++; }
    if (!mod.exports.length && !mod.isEntry && shown >= 5) continue;
    const ex = mod.exports.length ? joinList(mod.exports, 12) : mod.isEntry ? '(entry script)' : '(no exports)';
    const line = `- ${mod.path} — ${ex}`;
    if (used + line.length > budgetChars && shown >= 3) break;
    lines.push(line);
    used += line.length + 1;
    shown++;
    if (shown >= 30) break;
  }
  if (m.modules.length > shown) lines.push(`- +${m.modules.length - shown} more source files`);
  return lines.join('\n');
}

function recent(m) {
  if (!m.recent.length) return null;
  return `## Recent\n- ${m.recent.join(', ')}`;
}

function footer(m, o, estimate) {
  return `---\nbearings ${o.version} · fingerprint ${m.fingerprint.slice(0, 8)} · budget ${o.budget || 'unlimited'} · est. ${estimate} tokens`;
}

function compose(m, o, estimate) {
  const parts = [identity(m, o)];
  const push = (s) => { if (s) parts.push(s); };
  if (m.kind !== 'folder-of-projects') { push(runAndTest(m, o)); push(entryPoints(m)); }
  push(rulesSection(m));
  push(projects(m));
  if (!o.dropLayout) push(layout(m, o));
  if (!o.dropModules && m.kind !== 'folder-of-projects') push(modules(m, o));
  if (!o.dropRecent) push(recent(m));
  if (m.kind === 'empty') parts.push('Empty folder — nothing to map yet.');
  parts.push(footer(m, o, estimate));
  return parts.join('\n\n') + '\n';
}

function settle(m, o) {
  let est = 0;
  let md = '';
  for (let i = 0; i < 4; i++) {
    md = compose(m, o, est);
    const next = estimateTokens(md);
    if (next === est) break;
    est = next;
  }
  return { markdown: md, estimate: estimateTokens(md) };
}

/**
 * Render the model within `budget` tokens (0 = unlimited). Returns `{ markdown, estimate, dropped }`
 * where `dropped` lists the degradation steps taken, in order.
 */
export function render(model, { budget = 1500, version = '0.0.0' } = {}) {
  const o = { budget, version };
  const dropped = [];
  let r = settle(model, o);
  if (!budget) return { ...r, dropped };
  const steps = [
    ['modules', () => { o.dropModules = true; }],
    ['recent', () => { o.dropRecent = true; }],
    ['layout-depth', () => { o.shallowLayout = true; }],
    ['run-test-truncated', () => { o.truncateRun = true; }],
    ['layout-truncated', () => { o.truncateLayout = true; }],
    ['description-truncated', () => { o.shortDescription = true; }],
    ['layout', () => { o.dropLayout = true; }],
  ];
  // First try to fit the modules section into the room that is left.
  if (r.estimate > budget && model.modules?.length) {
    const without = settle(model, { ...o, dropModules: true });
    const room = (budget - without.estimate) * 3.5 - 40;
    if (room > 120) {
      o.moduleChars = room;
      r = settle(model, o);
    }
  }
  for (const [name, apply] of steps) {
    if (r.estimate <= budget) break;
    apply();
    dropped.push(name);
    r = settle(model, o);
  }
  return { ...r, dropped };
}
