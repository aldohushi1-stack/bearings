import { extractJs } from './js.mjs';
import { extractPython } from './python.mjs';
import { extractGo } from './go.mjs';
import { extractRust } from './rust.mjs';

const LANG_BY_EXT = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js',
  py: 'python', go: 'go', rs: 'rust',
};

export function languageOf(filePath) {
  const i = filePath.lastIndexOf('.');
  if (i < 0) return null;
  return LANG_BY_EXT[filePath.slice(i + 1).toLowerCase()] ?? null;
}

/** `{ exports: string[], imports: string[] }` for a file's text, or empty lists for unknown languages. */
export function extractFile(filePath, text) {
  switch (languageOf(filePath)) {
    case 'js': return extractJs(text);
    case 'python': return extractPython(text, { isInit: /(^|\/)__init__\.py$/.test(filePath) });
    case 'go': return extractGo(text);
    case 'rust': return extractRust(text);
    default: return { exports: [], imports: [] };
  }
}
