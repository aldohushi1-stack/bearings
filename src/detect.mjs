import fs from 'node:fs/promises';
import path from 'node:path';
import { filesOf } from './scan.mjs';

const MAX_READ = 256 * 1024;

const LANGS = [
  ['JavaScript', ['js', 'mjs', 'cjs', 'jsx']], ['TypeScript', ['ts', 'tsx', 'mts', 'cts']],
  ['Python', ['py', 'pyi']], ['Go', ['go']], ['Rust', ['rs']], ['Ruby', ['rb']], ['PHP', ['php']],
  ['Java', ['java']], ['Kotlin', ['kt', 'kts']], ['C#', ['cs']], ['C/C++', ['c', 'h', 'cc', 'cpp', 'hpp', 'cxx']],
  ['Swift', ['swift']], ['Dart', ['dart']], ['HTML', ['html', 'htm']], ['CSS', ['css', 'scss', 'sass', 'less']],
  ['Markdown', ['md', 'mdx']], ['Shell', ['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd']], ['SQL', ['sql']],
  ['YAML', ['yml', 'yaml']], ['JSON', ['json']], ['TOML', ['toml']], ['Vue', ['vue']], ['Svelte', ['svelte']],
];
const EXT_TO_LANG = new Map();
for (const [name, exts] of LANGS) for (const e of exts) EXT_TO_LANG.set(e, name);

const NODE_WEB = ['react', 'next', 'vite', 'svelte', '@sveltejs/kit', 'vue', 'nuxt', 'astro', '@angular/core', 'solid-js', 'preact', 'remix', '@remix-run/react', 'gatsby'];
const NODE_SERVER = ['express', 'fastify', 'koa', 'hono', '@nestjs/core', 'hapi', '@hapi/hapi', 'restify'];

/* -------------------------------------------------------------- readers */

async function readText(abs) {
  try {
    const h = await fs.open(abs, 'r');
    try {
      const st = await h.stat();
      const len = Math.min(st.size, MAX_READ);
      const buf = Buffer.alloc(len);
      await h.read(buf, 0, len, 0);
      let text = buf.toString('utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      return text;
    } finally { await h.close(); }
  } catch { return null; }
}

function parseJsonLoose(text) {
  if (text == null) return null;
  try { return JSON.parse(text); } catch {}
  try {
    // tsconfig-style: comments and trailing commas
    const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(cleaned);
  } catch { return null; }
}

/** Minimal TOML: top-level `[table]` and `[table.sub]` sections with `key = "value"` string pairs. */
function parseTomlLite(text) {
  const out = {};
  if (!text) return out;
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^\[\[?([^\]]+)\]\]?$/))) { section = m[1].trim(); out[section] ??= {}; continue; }
    if ((m = line.match(/^([\w.-]+)\s*=\s*(.*)$/))) {
      let v = m[2].trim();
      if (/^["']/.test(v)) v = v.slice(1).replace(/["']\s*$/, '');
      (out[section] ??= {})[m[1]] = v;
    }
  }
  return out;
}

function readmeInfo(text) {
  if (!text) return { title: null, paragraph: null, paragraphs: [] };
  const lines = text.split(/\r?\n/);
  let title = null;
  const paragraphs = [];
  let para = [];
  let seenTitle = false;
  const plain = (t) => t.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/<[^>]+>/g, '');
  const flush = () => { if (para.length) { paragraphs.push(plain(para.join(' ')).replace(/\s+/g, ' ').trim()); para = []; } };
  for (let i = 0; i < lines.length && paragraphs.length < 4; i++) {
    const line = lines[i].trim();
    if (!seenTitle) {
      if (/^#\s+/.test(line)) { title = line.replace(/^#\s+/, '').replace(/[*_`]/g, '').trim(); seenTitle = true; continue; }
      if (line && lines[i + 1] && /^=+\s*$/.test(lines[i + 1])) { title = line; seenTitle = true; i++; continue; }
      if (line.startsWith('<') || line.startsWith('[![') || line.startsWith('![') || !line) continue;
      seenTitle = true; // no heading; treat the first text as the paragraph start
    }
    if (/^#{2,}\s/.test(line) && paragraphs.length) break; // stop at the first section heading once we have something
    if (!line || line.startsWith('#') || line.startsWith('<') || line.startsWith('[![') || line.startsWith('![') || line.startsWith('|') || /^[-*]\s/.test(line) || line.startsWith('```')) { flush(); continue; }
    para.push(line.replace(/^>\s?/, ''));
  }
  flush();
  const clip = (p) => (p.length > 300 ? p.slice(0, 297).replace(/\s+\S*$/, '') + '…' : p);
  return { title, paragraph: paragraphs.length ? clip(paragraphs[0]) : null, paragraphs: paragraphs.map(clip) };
}

/** The README paragraph that reads like a description: the first one naming the project, else the first. */
function pickDescription(readme, name) {
  if (!readme.paragraphs?.length) return null;
  const n = (name || '').toLowerCase().replace(/^@[^/]+\//, '');
  if (n.length >= 3) {
    const hit = readme.paragraphs.slice(0, 3).find((p) => p.toLowerCase().includes(n) && !/^(we'?re|we are|announcing|welcome|thank)/i.test(p));
    if (hit) return hit;
  }
  return readme.paragraphs.find((p) => !/^(we'?re|we are|announcing|thank)/i.test(p)) || readme.paragraphs[0];
}

function makefileTargets(text) {
  if (!text) return [];
  const out = [];
  for (const m of text.matchAll(/^([A-Za-z][\w.-]*)\s*:(?!=)/gm)) {
    if (m[1] === 'PHONY' || m[1].startsWith('.')) continue;
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function justfileRecipes(text) {
  if (!text) return [];
  const out = [];
  for (const m of text.matchAll(/^([A-Za-z][\w-]*)(?:\s+[^:\n]*)?:(?!=)/gm)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function envKeys(text) {
  if (!text) return [];
  const keys = [];
  for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) if (!keys.includes(m[1])) keys.push(m[1]);
  return keys;
}

function licenseOf(text, manifestLicense) {
  const head = (text || '').slice(0, 400);
  if (/MIT License|Permission is hereby granted, free of charge/i.test(head)) return 'MIT';
  if (/Apache License/i.test(head)) return 'Apache-2.0';
  if (/GNU AFFERO/i.test(head)) return 'AGPL';
  if (/GNU LESSER/i.test(head)) return 'LGPL';
  if (/GNU GENERAL PUBLIC/i.test(head)) return 'GPL';
  if (/BSD/i.test(head)) return 'BSD';
  if (/Mozilla Public License/i.test(head)) return 'MPL-2.0';
  if (/unlicense/i.test(head)) return 'Unlicense';
  if (manifestLicense) return typeof manifestLicense === 'string' ? manifestLicense : manifestLicense.type ?? null;
  return text ? 'see LICENSE' : null;
}

function editorconfigIndent(text) {
  if (!text) return null;
  const style = text.match(/^\s*indent_style\s*=\s*(\w+)/m)?.[1];
  const size = text.match(/^\s*indent_size\s*=\s*(\d+)/m)?.[1];
  if (style === 'tab') return 'tabs';
  if (style === 'space') return size ? `${size} spaces` : 'spaces';
  return null;
}

/* ------------------------------------------------------------- helpers */

const dirLabel = (name) => {
  const n = name.toLowerCase();
  if (/^(test|tests|__tests__|spec|specs|e2e|cypress|fixtures)$/.test(n)) return 'tests';
  if (/^(doc|docs|documentation|wiki)$/.test(n)) return 'docs';
  if (/^(src|lib|app|apps|packages|core|source|internal|cmd|pkg|modules)$/.test(n)) return 'source';
  if (/^(assets|public|static|media|img|images|fonts|icons|audio|video|sounds)$/.test(n)) return 'assets';
  if (/^(\.github|\.gitlab|config|configs|\.vscode|\.circleci|\.claude|\.cursor)$/.test(n)) return 'config';
  if (/^(script|scripts|tools|tool|bin|build-tools|ci|infra|deploy|ops)$/.test(n)) return 'scripts';
  if (/^(example|examples|samples|demo|demos|playground)$/.test(n)) return 'examples';
  if (/^(migrations|migration|db|database|prisma|schema)$/.test(n)) return 'data';
  if (/^(locales|i18n|translations|lang)$/.test(n)) return 'i18n';
  if (/^(notes|journal|sessions|logs)$/.test(n)) return 'notes';
  return null;
};

function topOf(p) { const i = p.indexOf('/'); return i < 0 ? null : p.slice(0, i); }


/** Workspace globs from package.json, pnpm-workspace.yaml, lerna.json or Cargo [workspace] members. */
async function workspaceGlobs({ pkg, cargo, has, abs }) {
  const out = [];
  const w = pkg?.workspaces;
  if (Array.isArray(w)) out.push(...w);
  else if (w && Array.isArray(w.packages)) out.push(...w.packages);
  if (has('pnpm-workspace.yaml')) {
    const text = (await readText(abs('pnpm-workspace.yaml'))) || '';
    const block = text.match(/^packages:\s*\n((?:[ \t]+-[^\n]*\n?)+)/m);
    if (block) for (const m of block[1].matchAll(/^[ \t]+-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)) out.push(m[1].trim());
  }
  if (has('lerna.json')) {
    const l = parseJsonLoose(await readText(abs('lerna.json')));
    if (Array.isArray(l?.packages)) out.push(...l.packages);
  }
  if (cargo?.workspace) {
    const text = (await readText(abs('Cargo.toml'))) || '';
    const m = text.match(/\[workspace\][\s\S]*?members\s*=\s*\[([^\]]*)\]/);
    if (m) for (const x of m[1].matchAll(/["']([^"']+)["']/g)) out.push(x[1]);
  }
  return [...new Set(out.filter((g) => typeof g === 'string' && g && !g.startsWith('!')))];
}

function globToRegexLite(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return re.replace(/^\.\//, '');
}

/* --------------------------------------------------------------- scope */

/**
 * Detect the identity of one scope (the root, or a subproject). `files` are the
 * scan entries whose paths fall under `prefix` ('' for root), with the prefix stripped.
 */
async function detectScope(root, prefix, files, opts = {}) {
  const abs = (rel) => path.join(root, prefix ? path.join(prefix, rel) : rel);
  const has = (rel) => files.some((f) => f.path === rel);
  const names = new Set(files.map((f) => f.path));
  const rootFiles = files.filter((f) => !f.path.includes('/'));

  const pkg = has('package.json') ? parseJsonLoose(await readText(abs('package.json'))) : null;
  const pyproject = has('pyproject.toml') ? parseTomlLite(await readText(abs('pyproject.toml'))) : null;
  const cargo = has('Cargo.toml') ? parseTomlLite(await readText(abs('Cargo.toml'))) : null;
  const gomod = has('go.mod') ? await readText(abs('go.mod')) : null;
  const readmeName = [...names].find((n) => /^readme(\.md|\.markdown|\.rst|\.txt)?$/i.test(n));
  const readme = readmeName ? readmeInfo(await readText(abs(readmeName))) : { title: null, paragraph: null };

  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.peerDependencies || {}) };
  const depNames = Object.keys(deps);
  const hasDep = (...ns) => ns.some((n) => depNames.includes(n));

  /* census */
  const census = new Map();
  for (const f of files) {
    if (f.asset || f.lockfile) continue;
    const lang = EXT_TO_LANG.get(f.ext);
    if (lang) census.set(lang, (census.get(lang) || 0) + 1);
  }
  const languages = [...census.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, files: count }));
  const count = (ext) => files.filter((f) => f.ext === ext).length;

  /* subprojects (only computed for the root scope) */
  const rootManifest = pkg || pyproject || cargo || gomod || has('setup.py') || has('setup.cfg');
  const workspaces = await workspaceGlobs({ pkg, cargo, has, abs });
  let subprojects = [];
  let projectGroups = [];
  if (!prefix && !opts.noSub) {
    const subFilesOf = (dir) => files.filter((f) => f.path.startsWith(dir + '/')).map((f) => ({ ...f, path: f.path.slice(dir.length + 1) }));
    const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|setup\.py|Cargo\.toml|go\.mod|composer\.json|Gemfile|pubspec\.yaml|mix\.exs|build\.gradle(\.kts)?|pom\.xml)$/;
    if (!rootManifest) {
      // A folder of projects: each immediate subfolder that carries a manifest, a .git, or a web page of its own.
      const marker = (rel) => MANIFEST.test(rel) || /\.html?$/i.test(rel);
      const tops = [...new Set(files.map((f) => topOf(f.path)).filter(Boolean))];
      for (const top of tops) {
        const sub = subFilesOf(top);
        let isProject = sub.some((f) => !f.path.includes('/') && marker(f.path));
        if (!isProject) { try { isProject = (await fs.stat(path.join(root, top, '.git'))).isDirectory(); } catch {} }
        if (!isProject) continue;
        const d = await detectScope(root, top, sub, { noSub: true });
        subprojects.push({ path: top, name: d.name, kind: d.kind, description: d.description, files: sub.length });
      }
    } else {
      // A monorepo: packages named by the workspace globs, or found under the conventional parents.
      const manifestDirs = [...new Set(files.filter((f) => f.path.includes('/') && MANIFEST.test(f.path) && f.path.split('/').length <= 5).map((f) => f.path.slice(0, f.path.lastIndexOf('/'))))];
      let keep;
      if (workspaces.length) {
        const res = workspaces.map((g) => new RegExp(`^${globToRegexLite(g.replace(/\/$/, ''))}$`));
        keep = manifestDirs.filter((d) => res.some((re) => re.test(d)));
      } else {
        keep = manifestDirs.filter((d) => /^(packages|apps|libs|services|crates|modules|plugins|workspaces|extensions|integrations)\/[^/]+$/.test(d));
      }
      keep.sort();
      // Only top-most packages: a manifest inside another kept package is that package's business.
      keep = keep.filter((d) => !keep.some((o) => o !== d && d.startsWith(o + '/')));
      const withKinds = keep.length <= 12;
      for (const dir of keep) {
        const sub = subFilesOf(dir);
        let d = null;
        if (withKinds) d = await detectScope(root, dir, sub, { noSub: true });
        subprojects.push({ path: dir, name: d?.name ?? null, kind: d?.kind ?? null, description: d?.description ?? null, files: sub.length, nested: true });
      }
      // Group by parent folder for rendering: packages/ — 3 packages: vite (426), …
      const groups = new Map();
      for (const p of subprojects) {
        const parent = p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/')) : '';
        if (!groups.has(parent)) groups.set(parent, { parent, packages: [], files: 0 });
        const g = groups.get(parent);
        g.packages.push(p);
        g.files += p.files;
      }
      projectGroups = [...groups.values()].sort((a, b) => b.files - a.files || a.parent.localeCompare(b.parent));
      for (const g of projectGroups) g.packages.sort((a, b) => b.files - a.files || a.path.localeCompare(b.path));
    }
  }

  /* kind */
  const rootHtml = rootFiles.filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path).sort();
  const mdCount = count('md') + count('mdx');
  let kind;
  if (files.length === 0) kind = 'empty';
  else if (!prefix && !rootManifest && subprojects.length >= 2) kind = 'folder-of-projects';
  else if (!prefix && (workspaces.length || has('lerna.json') || subprojects.some((p) => p.nested))) kind = 'monorepo';
  else if (pkg) {
    if (pkg.bin) kind = 'node-cli';
    else if (hasDep(...NODE_WEB)) kind = 'node-web';
    else if (hasDep(...NODE_SERVER)) kind = 'node-server';
    else kind = 'node-library';
  } else if (pyproject || has('setup.py') || has('setup.cfg')) kind = 'python-package';
  else if (cargo) kind = 'rust';
  else if (gomod) kind = 'go';
  else if (count('py') > 0 && count('py') >= (languages[0]?.files ?? 0)) kind = 'python-scripts';
  else if (rootHtml.length && rootHtml.includes('index.html') && files.some((f) => f.path.includes('/') && /^(assets|css|js|static|public|img|images)\//.test(f.path))) kind = 'static-site';
  else if (rootHtml.length && files.filter((f) => !/\.(html?|md)$/i.test(f.path)).length <= 2) kind = 'single-file-web';
  else if (rootHtml.length && rootHtml.length >= files.length * 0.5) kind = 'single-file-web';
  else if (mdCount >= 2 && mdCount >= files.length * 0.6) kind = 'docs';
  else kind = 'mixed';

  /* names */
  const cargoPkg = cargo?.package || {};
  const py = pyproject?.project || pyproject?.['tool.poetry'] || {};
  const goModule = gomod?.match(/^module\s+(\S+)/m)?.[1];
  const name = pkg?.name || py.name || cargoPkg.name || (goModule && goModule.split('/').pop()) || readme.title || path.basename(prefix ? path.join(root, prefix) : root);
  const description = pkg?.description || py.description || cargoPkg.description || pickDescription(readme, name) || null;

  /* package manager */
  let packageManager = null;
  if (pkg) {
    const pm = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
    packageManager = pm || (has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm');
  } else if (pyproject || has('setup.py') || has('requirements.txt')) {
    packageManager = has('uv.lock') ? 'uv' : has('poetry.lock') || pyproject?.['tool.poetry'] ? 'poetry' : has('Pipfile') ? 'pipenv' : has('pdm.lock') ? 'pdm' : 'pip';
  } else if (cargo) packageManager = 'cargo';
  else if (gomod) packageManager = 'go';

  const moduleSystem = pkg ? (pkg.type === 'module' ? 'esm' : (count('mjs') && !count('cjs') && !count('js') ? 'esm' : 'cjs')) : null;

  /* scripts */
  const scripts = [];
  const runPrefix = packageManager === 'yarn' ? 'yarn' : packageManager === 'bun' ? 'bun run' : packageManager === 'pnpm' ? 'pnpm' : 'npm run';
  if (pkg?.scripts) {
    for (const [k, v] of Object.entries(pkg.scripts)) {
      if (/^(preinstall|install|postinstall|prepublish|prepublishOnly|prepack|postpack|prepare|preversion|version|postversion|preuninstall|postuninstall)$/.test(k)) continue;
      if (/^(pre|post)[a-z]/.test(k) && pkg.scripts[k.replace(/^(pre|post)/, '')]) continue;
      const bare = ['test', 'start', 'stop', 'restart'].includes(k);
      const invoke = packageManager === 'npm' || !packageManager ? (bare ? `npm ${k}` : `npm run ${k}`) : (packageManager === 'pnpm' && bare ? `pnpm ${k}` : `${runPrefix} ${k}`);
      scripts.push({ name: k, cmd: String(v), invoke, source: 'npm' });
    }
  }
  if (pyproject?.['project.scripts']) {
    for (const [k, v] of Object.entries(pyproject['project.scripts'])) scripts.push({ name: k, cmd: v, invoke: k, source: 'console' });
  }
  const makefileName = [...names].find((n) => /^(GNUmakefile|Makefile|makefile)$/.test(n));
  if (makefileName) for (const t of makefileTargets(await readText(abs(makefileName)))) scripts.push({ name: t, cmd: null, invoke: `make ${t}`, source: 'make' });
  const justName = [...names].find((n) => /^(justfile|Justfile|\.justfile)$/.test(n));
  if (justName) for (const t of justfileRecipes(await readText(abs(justName)))) scripts.push({ name: t, cmd: null, invoke: `just ${t}`, source: 'just' });

  /* test runner */
  const scriptText = Object.values(pkg?.scripts || {}).join(' ');
  const testDir = ['tests', 'test', '__tests__', 'spec', 'e2e'].find((d) => files.some((f) => f.path.startsWith(d + '/'))) || null;
  const test = { runner: null, dir: testDir, extra: [] };
  if (pkg) {
    if (/\bvitest\b/.test(scriptText) || hasDep('vitest')) test.runner = 'vitest';
    else if (/\bjest\b/.test(scriptText) || hasDep('jest')) test.runner = 'jest';
    else if (/\bmocha\b/.test(scriptText) || hasDep('mocha')) test.runner = 'mocha';
    else if (/\bava\b/.test(scriptText) || hasDep('ava')) test.runner = 'ava';
    else if (/\btap\b/.test(scriptText) || hasDep('tap')) test.runner = 'tap';
    else if (/node\s+--test|\bnode:test\b/.test(scriptText) || files.some((f) => /\.test\.[cm]?js$/.test(f.path))) test.runner = 'node:test';
    if (hasDep('@playwright/test', 'playwright') || names.has('playwright.config.ts') || names.has('playwright.config.js')) test.extra.push('playwright');
    if (hasDep('cypress')) test.extra.push('cypress');
  } else if (pyproject || count('py')) {
    if (pyproject?.['tool.pytest.ini_options'] || pyproject?.['tool.pytest'] || has('pytest.ini') || has('conftest.py') || files.some((f) => /(^|\/)test_[^/]+\.py$/.test(f.path))) test.runner = 'pytest';
    else if (files.some((f) => /(^|\/)test[^/]*\.py$/.test(f.path))) test.runner = 'unittest';
  } else if (cargo) test.runner = 'cargo test';
  else if (gomod) test.runner = 'go test ./...';

  /* lint / format */
  const lint = [];
  const cfg = (re) => [...names].some((n) => re.test(n));
  if (hasDep('eslint') || cfg(/^(\.eslintrc(\..*)?|eslint\.config\.[cm]?[jt]s)$/)) lint.push('eslint');
  if (hasDep('prettier') || cfg(/^\.prettierrc(\..*)?$|^prettier\.config\./)) lint.push('prettier');
  if (hasDep('@biomejs/biome') || cfg(/^biome\.jsonc?$/)) lint.push('biome');
  if (pyproject?.['tool.ruff'] || cfg(/^(ruff\.toml|\.ruff\.toml)$/)) lint.push('ruff');
  if (pyproject?.['tool.black']) lint.push('black');
  if (pyproject?.['tool.mypy'] || cfg(/^mypy\.ini$/)) lint.push('mypy');
  if (pyproject?.['tool.pyright'] || cfg(/^pyrightconfig\.json$/)) lint.push('pyright');
  if (cfg(/^\.flake8$/)) lint.push('flake8');
  if (cfg(/^(\.golangci\.ya?ml)$/)) lint.push('golangci-lint');
  if (cfg(/^(clippy\.toml|rustfmt\.toml)$/)) lint.push('clippy/rustfmt');

  /* ci / docker */
  const ci = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path)).map((f) => f.path.split('/').pop());
  if (has('.gitlab-ci.yml')) ci.push('.gitlab-ci.yml');
  if (has('azure-pipelines.yml')) ci.push('azure-pipelines.yml');
  if (has('Jenkinsfile')) ci.push('Jenkinsfile');
  const docker = [...names].filter((n) => /^(Dockerfile(\..*)?|docker-compose(\..*)?\.ya?ml|compose\.ya?ml)$/.test(n));

  /* entry points */
  const entries = [];
  const addEntry = (p, label) => { if (p && names.has(p) && !entries.some((e) => e.path === p)) entries.push({ path: p, label }); };
  const normEntry = (p) => typeof p === 'string' ? p.replace(/^\.\//, '') : null;
  if (pkg) {
    if (typeof pkg.bin === 'string') addEntry(normEntry(pkg.bin), `bin: ${pkg.name}`);
    else if (pkg.bin && typeof pkg.bin === 'object') for (const [k, v] of Object.entries(pkg.bin)) addEntry(normEntry(v), `bin: ${k}`);
    addEntry(normEntry(pkg.main), 'main');
    addEntry(normEntry(pkg.module), 'module');
    const exp = pkg.exports;
    const expEntry = typeof exp === 'string' ? exp : exp?.['.'] ? (typeof exp['.'] === 'string' ? exp['.'] : exp['.'].import || exp['.'].default) : null;
    addEntry(normEntry(typeof expEntry === 'string' ? expEntry : null), 'exports');
    if (!entries.length) for (const c of ['src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.mjs', 'src/main.ts', 'src/main.tsx', 'src/main.js', 'index.js', 'index.mjs', 'index.ts', 'server.js', 'server.ts', 'app.js', 'app.ts', 'src/app.ts', 'src/server.ts', 'src/cli.ts', 'src/cli.js', 'src/cli.mjs']) addEntry(c, 'entry');
  }
  if (pyproject?.['project.scripts']) {
    for (const [k, v] of Object.entries(pyproject['project.scripts'])) {
      const mod = String(v).split(':')[0].replace(/\./g, '/');
      for (const c of [`src/${mod}.py`, `${mod}.py`, `src/${mod}/__init__.py`, `${mod}/__init__.py`]) addEntry(c, `console: ${k}`);
    }
  }
  if (pyproject || count('py')) for (const c of ['manage.py', 'app.py', 'main.py', 'run.py', 'server.py', 'wsgi.py', 'asgi.py', ...files.filter((f) => /(^|\/)__main__\.py$/.test(f.path)).map((f) => f.path)]) addEntry(c, 'entry');
  if (cargo) for (const c of ['src/main.rs', 'src/lib.rs']) addEntry(c, 'entry');
  if (gomod) { addEntry('main.go', 'entry'); for (const f of files) if (/^cmd\/[^/]+\/main\.go$/.test(f.path)) addEntry(f.path, 'entry'); }
  if (!pkg && !pyproject && !cargo && !gomod) for (const h of rootHtml) addEntry(h, 'page');
  else if (kind === 'static-site' || kind === 'single-file-web') for (const h of rootHtml) addEntry(h, 'page');

  /* rules & conventions */
  const rules = {
    claudeMd: has('CLAUDE.md') || has('.claude/CLAUDE.md') || has('CLAUDE.local.md'),
    claudeRules: files.filter((f) => /^\.claude\/rules\/.+\.md$/.test(f.path)).length,
    agentsMd: has('AGENTS.md'),
    geminiMd: has('GEMINI.md'),
    cursorRules: has('.cursorrules') || files.some((f) => f.path.startsWith('.cursor/rules/')),
    copilot: has('.github/copilot-instructions.md'),
    contributing: [...names].find((n) => /^contributing(\.md)?$/i.test(n)) || null,
    codeowners: has('CODEOWNERS') || has('.github/CODEOWNERS'),
    indent: has('.editorconfig') ? editorconfigIndent(await readText(abs('.editorconfig'))) : null,
    tsStrict: has('tsconfig.json') ? parseJsonLoose(await readText(abs('tsconfig.json')))?.compilerOptions?.strict === true : null,
    precommit: has('.pre-commit-config.yaml') || files.some((f) => f.path.startsWith('.husky/')) || hasDep('husky', 'lint-staged'),
  };

  const licenseName = [...names].find((n) => /^(LICENSE|LICENCE|COPYING)(\..*)?$/i.test(n));
  const license = licenseOf(licenseName ? await readText(abs(licenseName)) : null, pkg?.license || py.license || cargoPkg.license);

  const envExample = [...names].find((n) => /^\.env\.(example|sample|template|dist)$/i.test(n));
  const envKeyList = envExample ? envKeys(await readText(abs(envExample))) : [];
  const envPresent = rootFiles.some((f) => /^\.env(\.local|\.development|\.production)?$/i.test(f.path));

  return {
    name, description, kind, languages, packageManager, moduleSystem, scripts, test, lint, ci, docker,
    entries: entries.map((e) => e.path), entryLabels: entries, rules, license, envKeys: envKeyList, envPresent,
    envExample: envExample || null, readmeFirstParagraph: readme.paragraph, readme: readmeName || null,
    subprojects, projectGroups, workspaces: workspaces.length ? workspaces : null,
  };
}

/* -------------------------------------------------------------- layout */

function layoutOf(files, dirEntries) {
  const top = new Map();
  const dirs = new Set(dirEntries.filter((d) => d.depth === 1).map((d) => d.path));
  for (const d of dirs) top.set(d, { name: d, files: 0, exts: new Map(), children: new Map() });
  let rootFiles = 0;
  for (const f of files) {
    const t = topOf(f.path);
    if (!t) { rootFiles++; continue; }
    if (!top.has(t)) top.set(t, { name: t, files: 0, exts: new Map(), children: new Map() });
    const e = top.get(t);
    e.files++;
    if (!f.asset) e.exts.set(f.ext, (e.exts.get(f.ext) || 0) + 1);
    const rest = f.path.slice(t.length + 1);
    const c = topOf(rest);
    if (c) e.children.set(c, (e.children.get(c) || 0) + 1);
  }
  const dominant = (m) => [...m.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
  const list = [...top.values()].map((e) => ({
    name: e.name, files: e.files, ext: dominant(e.exts), label: dirLabel(e.name),
    children: [...e.children.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ name, files: n })),
  }));
  list.sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  return { rootFiles, dirs: list };
}

/* ---------------------------------------------------------------- main */

export async function detect(root, scanResult) {
  root = path.resolve(root);
  const files = filesOf(scanResult);
  const model = await detectScope(root, '', files);
  model.layout = layoutOf(files, scanResult.entries.filter((e) => e.dir));
  model.skipped = [...(scanResult.skippedRoot || [])].filter((n) => n !== '.bearings').sort();
  model.skippedNested = Object.keys(scanResult.skipped).filter((n) => n !== '.bearings' && !model.skipped.includes(n)).sort();
  model.truncated = scanResult.truncated;
  model.fileCount = files.length;
  model.assetCount = files.filter((f) => f.asset).length;
  model.envFileCount = files.filter((f) => f.sensitive && /(^|\/)\.env(\.|$)/i.test(f.path)).length;
  model.sensitiveCount = files.filter((f) => f.sensitive).length - model.envFileCount;
  model.recent = [...files].filter((f) => !f.sensitive && !f.lockfile).sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path)).slice(0, 5).map((f) => f.path);
  model.gitBranch = null;
  try {
    const head = await fs.readFile(path.join(root, '.git', 'HEAD'), 'utf8');
    const m = head.match(/ref:\s*refs\/heads\/(\S+)/);
    model.gitBranch = m ? m[1] : head.trim().slice(0, 8);
  } catch {}
  return model;
}
