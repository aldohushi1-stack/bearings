export function extractRust(text) {
  const exports = [];
  const imports = [];
  for (const m of text.matchAll(/^[ \t]*pub\s+(?:(?:async|unsafe|const|extern\s+"[^"]*")\s+)*(?:fn|struct|enum|trait|mod|type|const|static|union)\s+(\w+)/gm)) exports.push(m[1]);
  for (const m of text.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) imports.push(`mod:${m[1]}`);
  for (const m of text.matchAll(/^[ \t]*use\s+(crate|super|self)::([\w:]+)/gm)) imports.push(`${m[1]}::${m[2]}`);
  return { exports: [...new Set(exports)], imports: [...new Set(imports)] };
}
