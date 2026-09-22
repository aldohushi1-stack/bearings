const TEST_RE = /(^|\/)(test|tests|__tests__|spec|specs|e2e|fixtures)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]+|[^/]+_test)\.py$|_test\.go$/;
const CONFIG_RE = /(^|\/)[\w.-]*\.config\.[cm]?[jt]sx?$|(^|\/)\.[\w-]+rc\.[cm]?js$|(^|\/)(setup|conftest)\.py$|(^|\/)(gulpfile|gruntfile|webpack\.[\w.]*|rollup\.[\w.]*|vite\.[\w.]*|tailwind\.[\w.]*|postcss\.[\w.]*)\.[cm]?[jt]s$/i;
const SRC_RE = /^(src|lib|app|packages|apps|core|internal|cmd|pkg)\//;
const EXAMPLE_RE = /(^|\/)(examples?|samples?|demos?|playground|benchmarks?|bench|fixtures|__mocks__|docs?|scripts?|tools)\//;

/** score = 10·isEntry + 2·importedBy + 1·inSrc − depth − 5·isTest − 3·isConfig − 4·isExample; ties by path. */
export function rankModules(modules, { entries = [], importedBy = new Map() } = {}) {
  const entrySet = new Set(entries);
  const scored = modules.map((m) => {
    const depth = m.path.split('/').length - 1;
    const score = (entrySet.has(m.path) ? 10 : 0) + 2 * (importedBy.get(m.path) || 0) + (SRC_RE.test(m.path) ? 1 : 0)
      - depth - (TEST_RE.test(m.path) ? 5 : 0) - (CONFIG_RE.test(m.path) ? 3 : 0) - (EXAMPLE_RE.test(m.path) ? 4 : 0);
    return { ...m, score, importedBy: importedBy.get(m.path) || 0, isTest: TEST_RE.test(m.path), isExample: EXAMPLE_RE.test(m.path), isEntry: entrySet.has(m.path) };
  });
  scored.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return scored;
}
