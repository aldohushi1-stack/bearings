import path from 'node:path';

const JS_EXTS = ['ts', 'tsx', 'mts', 'cts', 'js', 'mjs', 'jsx', 'cjs'];
const JS_EXT_RE = /\.(js|mjs|cjs|jsx)$/;

function norm(p) {
  const n = path.posix.normalize(p.replace(/\\/g, '/'));
  return n === '.' ? '' : n.replace(/^\.\//, '');
}

function firstExisting(files, candidates) {
  for (const c of candidates) if (files.has(c)) return c;
  return null;
}

function resolveJs(fromPath, spec, files) {
  let base;
  if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
    base = norm(path.posix.join(path.posix.dirname(fromPath), spec));
  } else if (spec.startsWith('@/') || spec.startsWith('~/')) {
    const rest = spec.slice(2);
    return firstExisting(files, [`src/${rest}`, rest].flatMap((b) => [b, ...JS_EXTS.map((e) => `${b}.${e}`), ...JS_EXTS.map((e) => `${b}/index.${e}`)]));
  } else return null;
  const candidates = [base];
  if (JS_EXT_RE.test(base)) {
    const stem = base.replace(JS_EXT_RE, '');
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  }
  for (const e of JS_EXTS) candidates.push(`${base}.${e}`);
  for (const e of JS_EXTS) candidates.push(`${base}/index.${e}`);
  return firstExisting(files, candidates);
}

function sourceRoots(files) {
  const roots = new Set(['']);
  for (const f of files) {
    const parts = f.split('/');
    if (parts.length > 1) roots.add(parts[0]);
    if (parts.length > 2 && (parts[0] === 'src' || parts[0] === 'lib')) roots.add(`${parts[0]}/${parts[1]}`);
  }
  return [...roots];
}

function resolvePython(fromPath, spec, files) {
  const dots = spec.match(/^\.+/)?.[0].length ?? 0;
  const rest = spec.slice(dots).split('.').filter(Boolean).join('/');
  const tryAt = (base) => {
    const p = base && rest ? `${base}/${rest}` : base || rest;
    if (!p) return null;
    return firstExisting(files, [`${p}.py`, `${p}/__init__.py`]);
  };
  if (dots) {
    let base = path.posix.dirname(fromPath);
    for (let i = 1; i < dots; i++) base = path.posix.dirname(base);
    if (base === '.') base = '';
    if (!rest) return firstExisting(files, [base ? `${base}/__init__.py` : '__init__.py']);
    return tryAt(base);
  }
  for (const root of sourceRoots(files)) {
    const hit = tryAt(root);
    if (hit) return hit;
  }
  return null;
}

function resolveRust(fromPath, spec, files) {
  const dir = path.posix.dirname(fromPath);
  if (spec.startsWith('mod:')) {
    const name = spec.slice(4);
    const stem = path.posix.basename(fromPath, '.rs');
    const bases = stem === 'mod' || stem === 'lib' || stem === 'main' ? [dir] : [`${dir}/${stem}`, dir];
    return firstExisting(files, bases.flatMap((b) => [`${b}/${name}.rs`, `${b}/${name}/mod.rs`]));
  }
  const m = spec.match(/^(crate|super|self)::([\w:]+)/);
  if (!m) return null;
  const parts = m[2].split('::');
  const start = m[1] === 'crate' ? 'src' : m[1] === 'super' ? path.posix.dirname(dir) : dir;
  const candidates = [];
  for (let n = parts.length; n >= 1; n--) {
    const p = [start, ...parts.slice(0, n)].join('/');
    candidates.push(`${p}.rs`, `${p}/mod.rs`);
  }
  return firstExisting(files, candidates);
}

/** Map an import specifier from `fromPath` to a project file, or null when external/unresolved. */
export function resolveImport(fromPath, spec, files) {
  fromPath = fromPath.replace(/\\/g, '/');
  if (fromPath.endsWith('.py')) return resolvePython(fromPath, spec, files);
  if (fromPath.endsWith('.rs')) return resolveRust(fromPath, spec, files);
  if (fromPath.endsWith('.go')) return null;
  return resolveJs(fromPath, spec, files);
}

/** `Map<path, number>` — how many project files import each file. */
export function importedBy(modules) {
  const files = new Set(modules.map((m) => m.path));
  const counts = new Map();
  const isTest = (p) => /(^|\/)(test|tests|__tests__|spec|specs|e2e|fixtures)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]+|[^/]+_test)\.py$|_test\.go$/.test(p);
  for (const m of modules) {
    const seen = new Set();
    const fromTest = isTest(m.path);
    for (const spec of m.imports) {
      const target = resolveImport(m.path, spec, files);
      if (!target || target === m.path || seen.has(target)) continue;
      if (fromTest && isTest(target)) continue; // test helpers imported by tests say nothing about the product
      seen.add(target);
      counts.set(target, (counts.get(target) || 0) + 1);
    }
  }
  return counts;
}
