import fs from 'node:fs/promises';
import path from 'node:path';

/** Directories never walked. Present ones are counted in `skipped`. */
export const DEFAULT_IGNORE_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.cache', '.parcel-cache', '.turbo', '.vercel', '.netlify',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.venv', 'venv', '.tox', '.eggs',
  'target', 'vendor', '.idea', '.gradle', '.terraform', '.bearings', '.claude-scratch',
]);

const ASSET_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tif', 'tiff', 'avif', 'heic',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'wav', 'ogg', 'oga', 'webm', 'mov', 'avi', 'mkv', 'm4a', 'flac', 'aac',
  'zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar', 'jar', 'war',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods',
  'bin', 'exe', 'dll', 'so', 'dylib', 'wasm', 'class', 'pyc', 'pyo', 'o', 'a', 'lib', 'obj',
  'db', 'sqlite', 'sqlite3', 'parquet', 'npy', 'npz', 'pkl', 'pickle', 'h5', 'onnx', 'pt', 'pth',
  'safetensors', 'gguf', 'ckpt', 'iso', 'dmg', 'img', 'psd', 'ai', 'sketch', 'fig',
  'glb', 'gltf', 'stl', '3mf', 'fbx', 'blend', 'lock', 'lockb',
]);

/** Files never listed: the agent's own scratch state, which would otherwise churn "Recent". */
const DEFAULT_IGNORE_FILES = new Set(['.claude/settings.local.json', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

const LOCKFILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'uv.lock',
  'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'composer.lock', 'Gemfile.lock',
]);

const SENSITIVE = [
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /^credentials?(\.|$)/i, /^secrets?(\.|$)/i, /^\.env(\..*)?$/i, /^\.netrc$/i, /^\.npmrc$/i,
  /^\.pypirc$/i, /^service-account.*\.json$/i, /^\.?htpasswd$/i,
];

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function isSensitiveName(name) {
  // .env.example/.env.sample/.env.template are documentation, not secrets.
  if (/^\.env\.(example|sample|template|dist)$/i.test(name)) return false;
  return SENSITIVE.some((re) => re.test(name));
}

/* ---------------------------------------------------------------- ignore */

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // '**/' → any number of directories; '/**' → anything below; '**' → anything
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      // Character class, e.g. [Bb]in or *.py[cod]; pass it through when it closes.
      const close = glob.indexOf(']', i + 1);
      if (close > i + 1) { re += '[' + glob.slice(i + 1, close).replace(/\\/g, '\\\\').replace(/^!/, '^') + ']'; i = close; }
      else re += '\\[';
    } else if ('.+^${}()|]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return re;
}

/**
 * Compile gitignore-style lines. Supported: `dir/`, `*.ext`, `name`, `/anchored`,
 * `path/to/x`, `**\/x`, `!negation`, comments and blanks. `base` is the directory
 * (relative, forward slashes, '' for root) the file lives in.
 */
export function compileIgnore(lines, base = '') {
  const rules = [];
  for (let raw of lines) {
    let line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    line = line.replace(/(?<!\\)\s+$/, '');
    let neg = false;
    if (line.startsWith('!')) { neg = true; line = line.slice(1); }
    if (line.startsWith('\\')) line = line.slice(1);
    let dirOnly = false;
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1); }
    let anchored = false;
    if (line.startsWith('/')) { anchored = true; line = line.slice(1); }
    else if (line.includes('/')) anchored = true;
    if (!line) continue;
    const body = globToRegex(line);
    const regex = anchored ? new RegExp(`^${body}$`) : new RegExp(`(?:^|/)${body}$`);
    rules.push({ neg, dirOnly, regex, base });
  }
  return rules;
}

function ruleMatches(rule, relPath, isDir) {
  let p = relPath;
  if (rule.base) {
    if (!p.startsWith(rule.base + '/')) return false;
    p = p.slice(rule.base.length + 1);
  }
  // The path itself.
  if ((!rule.dirOnly || isDir) && rule.regex.test(p)) return true;
  // Any ancestor directory.
  let idx = p.lastIndexOf('/');
  while (idx > 0) {
    const anc = p.slice(0, idx);
    if (rule.regex.test(anc)) return true;
    idx = anc.lastIndexOf('/');
  }
  return false;
}

/** Last matching rule wins; a negation re-includes. */
export function matchesIgnore(rules, relPath, isDir) {
  let ignored = false;
  for (const rule of rules) {
    if (ruleMatches(rule, relPath, isDir)) ignored = !rule.neg;
  }
  return ignored;
}

async function readIgnoreFile(p, base) {
  try {
    const text = (await fs.readFile(p, 'utf8')).replace(/^\uFEFF/, '');
    return compileIgnore(text.split('\n'), base);
  } catch { return []; }
}

/* ------------------------------------------------------------------ walk */

/**
 * Walk a folder. Returns `{ root, entries, skipped, truncated, outFile }` where each
 * entry is `{ path, dir, depth, size, mtimeMs, ext, asset, lockfile, sensitive }` with
 * forward-slash relative paths in sorted order. Never follows symlinks.
 */
export async function scan(root, opts = {}) {
  const maxDepth = opts.maxDepth ?? 8;
  const maxEntries = opts.maxEntries ?? 20000;
  const outFile = (opts.outFile ?? 'BEARINGS.md').replace(/\\/g, '/');
  const outBase = outFile.split('/').pop();
  root = path.resolve(root);
  const entries = [];
  const skipped = {};
  const skippedRoot = [];
  let truncated = false;
  let rules = [
    ...(await readIgnoreFile(path.join(root, '.gitignore'), '')),
    ...(await readIgnoreFile(path.join(root, '.bearingsignore'), '')),
    ...compileIgnore(opts.ignore ?? [], ''),
  ];

  // Breadth-first, sorted at every level, so a truncated walk still sees every shallow file
  // (manifests, READMEs, entry points) before it runs out of room deep in some subtree.
  const queue = [{ rel: '', depth: 0 }];
  while (queue.length && !truncated) {
    const { rel, depth } = queue.shift();
    const abs = rel ? path.join(root, rel) : root;
    let dirents;
    try { dirents = await fs.readdir(abs, { withFileTypes: true }); } catch { continue; }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (rel) {
      const nested = await readIgnoreFile(path.join(abs, '.gitignore'), rel);
      if (nested.length) rules = rules.concat(nested);
    }
    const subdirs = [];
    for (const d of dirents) {
      if (entries.length >= maxEntries) { truncated = true; break; }
      const name = d.name;
      const relPath = rel ? `${rel}/${name}` : name;
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(name)) {
          skipped[name] = (skipped[name] || 0) + 1;
          if (!rel) skippedRoot.push(name);
          continue;
        }
        if (matchesIgnore(rules, relPath, true)) continue;
        if (depth + 1 > maxDepth) continue;
        entries.push({ path: relPath, dir: true, depth: depth + 1 });
        subdirs.push({ rel: relPath, depth: depth + 1 });
        continue;
      }
      if (!d.isFile()) continue;
      if (relPath === outFile || name === outBase) continue; // the map itself, at any depth
      if (DEFAULT_IGNORE_FILES.has(relPath) || DEFAULT_IGNORE_FILES.has(name)) continue;
      if (matchesIgnore(rules, relPath, false)) continue;
      let st;
      try { st = await fs.stat(path.join(abs, name)); } catch { continue; }
      const ext = extOf(name);
      const lockfile = LOCKFILES.has(name);
      entries.push({
        path: relPath, dir: false, depth: depth + 1, size: st.size, mtimeMs: st.mtimeMs, ext,
        asset: ASSET_EXT.has(ext) || /\.min\.(js|css)$/i.test(name),
        lockfile, sensitive: isSensitiveName(name),
      });
    }
    queue.push(...subdirs);
  }
  return { root, entries, skipped, skippedRoot, truncated, outFile };
}

export const filesOf = (scanResult) => scanResult.entries.filter((e) => !e.dir);
