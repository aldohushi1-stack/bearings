export function extractPython(text, { isInit = false } = {}) {
  const lines = text.split(/\r?\n/);
  const defs = [];
  const imports = [];
  const reexports = [];
  let all = null;

  const allMatch = text.match(/^__all__\s*(?::\s*[^=]+)?=\s*[\[(]([\s\S]*?)[\])]/m);
  if (allMatch) {
    all = [...allMatch[1].matchAll(/['"]([\w]+)['"]/g)].map((m) => m[1]);
  }

  for (const line of lines) {
    let m;
    if ((m = line.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)/))) { if (!m[1].startsWith('_')) defs.push(m[1]); continue; }
    if ((m = line.match(/^class\s+([A-Za-z_]\w*)/))) { if (!m[1].startsWith('_')) defs.push(m[1]); continue; }
    if ((m = line.match(/^\s*from\s+(\.+[\w.]*|[\w.]+)\s+import\b(.*)$/))) {
      imports.push(m[1]);
      if (isInit && m[1].startsWith('.') && !/^\s*from\s+\.+\s+import/.test(line)) {
        for (const item of m[2].replace(/[()\\]/g, '').split(',')) {
          const n = item.trim().split(/\s+as\s+/).pop();
          if (/^[A-Za-z_]\w*$/.test(n) && !n.startsWith('_') && n !== '*') reexports.push(n);
        }
      }
      continue;
    }
    if ((m = line.match(/^([A-Za-z]\w*)\s*(?::[^=\n]+)?=(?!=)(.*)$/))) {
      // Module-level names, minus dunders, single letters and TypeVar/ParamSpec aliases.
      if (!/^(__\w+__)$/.test(m[1]) && m[1].length > 1 && !/\b(TypeVar|ParamSpec|TypeVarTuple|NewType)\s*\(/.test(m[2])) defs.push(m[1]);
      continue;
    }
    if ((m = line.match(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/))) {
      for (const part of m[1].split(',')) imports.push(part.trim().split(/\s+as\s+/)[0]);
    }
  }

  const exports = all ?? (isInit ? [...reexports, ...defs] : defs);
  return { exports: [...new Set(exports)], imports: [...new Set(imports)] };
}
