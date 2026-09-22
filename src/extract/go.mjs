export function extractGo(text) {
  const exports = [];
  const imports = [];
  for (const m of text.matchAll(/^func\s+([A-Z]\w*)/gm)) exports.push(m[1]);
  for (const m of text.matchAll(/^type\s+([A-Z]\w*)/gm)) exports.push(m[1]);
  for (const m of text.matchAll(/^import\s+"([^"]+)"/gm)) imports.push(m[1]);
  for (const block of text.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) {
    for (const m of block[1].matchAll(/"([^"]+)"/g)) imports.push(m[1]);
  }
  // Keep source order for exports (func and type were collected separately).
  const ordered = [...text.matchAll(/^(?:func|type)\s+([A-Z]\w*)/gm)].map((m) => m[1]);
  return { exports: [...new Set(ordered.length ? ordered : exports)], imports: [...new Set(imports)] };
}
