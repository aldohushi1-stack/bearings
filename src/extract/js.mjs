/** Names, not signatures. Regex-based on purpose: fast, zero-dependency, easy to extend. */

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

function braceNames(body) {
  const names = [];
  for (let item of body.split(',')) {
    item = item.trim().replace(/^type\s+/, '');
    if (!item) continue;
    const m = item.match(/^(?:[\w$]+|default)\s+as\s+([\w$]+)$/);
    if (m) { if (m[1] !== 'default') names.push(m[1]); continue; }
    const k = item.match(/^([\w$]+)\s*(?::|$)/);
    if (k && k[1] !== 'default') names.push(k[1]);
  }
  return names;
}

export function extractJs(text) {
  const src = stripComments(text);
  const hits = []; // { index, names }
  const push = (index, ...names) => hits.push({ index, names });

  for (const m of src.matchAll(/export\s+(default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/g)) push(m.index, m[1] ? `default:${m[2]}` : m[2]);
  for (const m of src.matchAll(/export\s+(default\s+)?(?:abstract\s+)?class\s+([\w$]+)/g)) push(m.index, m[1] ? `default:${m[2]}` : m[2]);
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:const|let|var)\s+([\w$]+)/g)) push(m.index, m[1]);
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:const\s+)?enum\s+([\w$]+)/g)) push(m.index, m[1]);
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:interface|type|namespace)\s+([\w$]+)/g)) push(m.index, m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) push(m.index, ...braceNames(m[1]));
  for (const m of src.matchAll(/export\s+default\s+(?!(?:async\s+)?function\b|(?:abstract\s+)?class\b)/g)) push(m.index, 'default');
  for (const m of src.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)) push(m.index, ...braceNames(m[1]));
  for (const m of src.matchAll(/module\.exports\s*=\s*(?!\{)([\w$]+|function|class|\(|async)/g)) push(m.index, 'default');
  for (const m of src.matchAll(/(?:^|[^.\w$])exports\.([\w$]+)\s*=/g)) push(m.index, m[1]);

  hits.sort((a, b) => a.index - b.index);
  const exports = [];
  for (const h of hits) for (const n of h.names) if (!exports.includes(n)) exports.push(n);

  const imps = [];
  const pushImp = (index, spec) => imps.push({ index, spec });
  for (const m of src.matchAll(/import\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) pushImp(m.index, m[1]);
  for (const m of src.matchAll(/export\s+(?:\*|\{[^}]*\})\s*from\s+['"]([^'"]+)['"]/g)) pushImp(m.index, m[1]);
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) pushImp(m.index, m[1]);
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) pushImp(m.index, m[1]);
  imps.sort((a, b) => a.index - b.index);
  const imports = [];
  for (const i of imps) if (!imports.includes(i.spec)) imports.push(i.spec);

  return { exports, imports };
}
