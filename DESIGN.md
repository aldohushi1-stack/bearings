# Bearings — design

*Get your bearings. A small, budgeted orientation map of any folder, handed to your coding agent at session start.*

Version 0.1.0 · September 2026 · Aldo Hushi

## 1. The problem

Every agent session starts cold. Before it does any work the agent spends its first ten or twenty tool calls finding its bearings: listing directories, opening `package.json` and the README, grepping for the entry point, working out how to run the tests, discovering the package manager and the conventions. Glassbox calls this the **startup tax**. It is paid on every new session, every resume, and again after every context compaction — and the answers are the same every time, because the project has not changed.

The existing fixes are symbol maps: aider's repo map, `atlas` (Rust), `agentmap` (TS/JS), `/repomap` (Python + tree-sitter). They answer *what functions exist and who imports whom*. That is the second question. The first question is *what is this, how do I run it, where do things live, what are the rules* — and none of them hand the answer to the agent automatically; most need a runtime, a binary, or the agent remembering to call a tool.

## 2. What Bearings does

1. **Builds** a short orientation map of a folder — `BEARINGS.md` — within a token budget (default 1,500 tokens).
2. **Delivers** it to Claude Code automatically through a `SessionStart` hook that fires on startup, resume, clear and compact, so the map is always in context and never has to be asked for.
3. **Stays fresh** without a watcher: the hook fingerprints the tree (paths, sizes, mtimes) and rebuilds only when something changed. A `watch` mode exists for people who read the file mid-session or feed other agents.
4. **Works on any folder**, not just a git repository or a codebase: a single-file HTML game, a Python script, a docs folder, or a Desktop folder holding thirty projects each get a sensible map.

Zero dependencies, Node ≥ 20, one command to install: `npx get-bearings init`.

## 3. Non-goals

- Not a symbol index, call graph or search tool. If you need "who calls `parseOrder`", use agentmap or atlas; Bearings will name the module and stop.
- Not an MCP server (v0.1). The map goes into context; the agent does not have to call anything.
- Never executes project code, never runs `git` (it reads `.git` itself), never touches the network. It reads file names, sizes, mtimes, the commit history from `.git`, and the text of a bounded set of small source and manifest files.
- Never prints file contents. It prints names: scripts, exported symbols, config keys, README's first paragraph.

## 4. The map

Sections, in priority order. When the budget is tight the renderer degrades from the bottom up (§6).

| # | Section | Source | Always kept? |
|---|---------|--------|--------------|
| 1 | **Identity** — name, one-line description, kind, languages, package manager, module system | `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, README first paragraph, file census | yes |
| 2 | **Run & test** — scripts, test runner, lint/format, CI, Docker | manifests, `Makefile`/`justfile` targets, config-file presence, `.github/workflows/*` names | yes (list may be truncated) |
| 3 | **Entry points** | `main`/`bin`/`exports`, `index.*`, `__main__.py`, `manage.py`, root `*.html` | yes |
| 4 | **Rules & conventions** — CLAUDE.md, AGENTS.md, `.cursor/rules`, CONTRIBUTING, `.editorconfig` indent, TS strict, license, `.env` (keys of `.env.example` only) | presence + tiny reads | yes |
| 5 | **Layout** — top-level directories with file counts, dominant extension, purpose label; depth 2 for the largest | walk | degrades to depth 1 |
| 6 | **Modules** — top-ranked source files, one line each: path and exported names | extractors + ranker | first to go |
| 7 | **Recent** — five files from the newest commits, current git branch (both read from `.git` directly, no subprocess); mtimes only when there is no repository | `.git` objects, `.git/HEAD`, mtimes | dropped before Layout |
| 8 | **Footer** — `bearings 0.1.0 · fingerprint ab12cd34 · budget 1500 · est. 1180 tokens` | — | yes |

The Markdown is written for two readers: an agent that wants facts in the first 200 tokens, and a human skimming the repo. No timestamps in the body, so a rebuild with no change is byte-identical and the file can be committed without churn.

### Kinds

`kind` is a coarse label chosen by rules, in this order: `folder-of-projects` (two or more subdirectories carry their own manifests and the root has none), `monorepo` (root manifest with `workspaces`, or `packages/*` manifests), `node-cli` (`bin`), `node-web` (`react`, `next`, `vite`, `svelte`, `vue`, `astro` in deps), `node-library`, `python-package`, `python-scripts`, `rust`, `go`, `static-site` (root `index.html` + assets), `single-file-web` (root `.html` files and little else), `docs` (mostly Markdown), `mixed`. The rule set is a table in `src/detect.mjs` and is the first thing contributors will want to extend.

## 5. Scanning

- Walk from the root breadth-first, depth ≤ 8, at most 20,000 entries; sorted order at every level so output is deterministic, and shallow files (manifests, README, entry points) are always seen before a huge subtree exhausts the cap.
- **Default ignores**: `.git`, `node_modules`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.cache`, `.turbo`, `__pycache__`, `.venv`, `venv`, `.tox`, `target`, `vendor`, `.idea`, `.DS_Store`, `.bearings`, plus `*.min.*`, lockfiles (counted, never read), binary extensions (images, fonts, archives, media, wasm) — counted as assets, never read.
- **`.gitignore`** at the root and in subdirectories is honoured with a small matcher: `dir/`, `*.ext`, `name`, `path/to/x`, `**/x`, `!negation`. Good enough for real repos; the unit tests pin exactly what is supported.
- **`.bearingsignore`** uses the same syntax for things you want out of the map but not out of git.
- Content is read only from: manifests and config files, README, rules files, and source files chosen for extraction (≤ 2,000 files, ≤ 256 KB each). Everything else is name/size/mtime only.
- Fingerprint = SHA-256 over the sorted list of `path\0size\0mtimeMs` for every walked entry, excluding the output file and `.bearings/`. Stored with the build in `.bearings/state.json`.

## 6. Budget

Tokens are estimated as `ceil(chars / 3.5)` — deliberately pessimistic for code-heavy text so the estimate is above what Claude's tokenizer will count. The renderer builds every section, then while `estimate > budget` it applies, in order:

1. drop Modules;
2. drop Recent;
3. collapse Layout to depth 1;
4. truncate Run & test lists to five entries each;
5. truncate Layout to the ten largest directories;
6. truncate the description to one sentence.

If Identity alone exceeds the budget the map is still emitted (it is a few lines). The footer records the estimate so anyone can see how close to the budget the map sits. `--budget 0` means unlimited.

## 7. Extractors

Regex-based, deliberately shallow — names, not signatures — so they stay fast, zero-dependency and easy to add to.

- **JS/TS** (`.js .mjs .cjs .jsx .ts .tsx .mts .cts`): `export function|class|const|let|var|enum|interface|type NAME`, `export default function NAME`, `export { a, b as c }`, `module.exports = { a, b }`, `exports.NAME =`. Imports: `from '...'`, `require('...')`, `import('...')`.
- **Python** (`.py`): top-level `def NAME`, `class NAME`; `__all__` wins when present. Imports: `import x`, `from x import`, relative `from .x`.
- **Go** (`.go`): `func Name` / `type Name` with a capital first letter.
- **Rust** (`.rs`): `pub fn|struct|enum|trait|mod NAME`.
- Everything else: listed by name in Layout only.

Imports are resolved to files inside the project (relative paths, `index.*`, extension guessing, Python dotted paths) to compute `importedBy` counts for ranking. Unresolved imports are ignored.

## 8. Ranking modules

`score = 10·isEntry + 2·importedBy + 1·inSrc − depth − 5·isTest − 3·isConfig`. Ties broken by path. The Modules section takes files in score order until its share of the budget (60 % of what is left after sections 1–5) is used.

## 9. CLI

```
bearings                       build BEARINGS.md for the current folder (alias: build)
bearings build [DIR] [--budget N] [--out FILE] [--json] [--print] [--quiet]
bearings print [DIR]           print the map (rebuilds first if stale)
bearings check [DIR]           exit 1 if BEARINGS.md is stale  (CI gate)
bearings init [DIR]            build + install the Claude Code hook for this project
bearings hook install [--global] [--command CMD] [--budget N]
bearings hook uninstall [--global]
bearings emit                  hook entry point: stdin JSON in, hook JSON out
bearings watch [DIR]           rebuild on change (debounced)
bearings --version | --help
```

## 10. The hook

`bearings hook install` merges this into `.claude/settings.json` (or `~/.claude/settings.json` with `--global`):

```json
{ "hooks": { "SessionStart": [ { "matcher": "startup|resume|clear|compact",
  "hooks": [ { "type": "command", "command": "npx -y get-bearings emit", "timeout": 30 } ] } ] } }
```

`emit` reads the hook's stdin JSON for `cwd`, rebuilds if the fingerprint changed, and prints

```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<the map>" } }
```

It always exits 0 and prints nothing on any error — a mapping tool must never block a session. The `compact` matcher is what keeps the map in context after compaction; `resume` and `clear` cover the other cold starts. Existing hooks are preserved; install is idempotent (it recognises its own command); uninstall removes only its own entry. `--command bearings` pins a global install instead of `npx`.

Other agents: `bearings print` pipes into anything; the README shows the one-line `AGENTS.md` / `.cursor/rules` / `GEMINI.md` pointer for Codex, Cursor and Gemini CLI.

## 11. Safety

- Reads only; writes only `BEARINGS.md` (or `--out`) and `.bearings/state.json`.
- `.env` is never read. `.env.example` contributes key names only. Files whose names suggest credentials (`id_rsa`, `*.pem`, `*.key`, `credentials*`, `secrets*`) are listed by count, never by name.
- No subprocesses, no network, no telemetry.
- Hook output is context the agent will read; the map contains only names and manifest text, so the prompt-injection surface is the project's own README first paragraph and script names — the same text the agent would read anyway.

## 12. Tests

`node --test`, zero dependencies. Fixtures are small real-shaped projects under `test/fixtures/` (`node-cli`, `python-pkg`, `single-html`, `folder-of-projects`, `monorepo`) plus temp dirs built in-test for mtime and ignore cases. `test/git.test.mjs` shells out to real `git` to build repositories to read — the library never does, only the tests.

- scan: default ignores, `.gitignore` forms (including nested files, character classes and a BOM), `.bearingsignore`, depth cap, breadth-first order, forward slashes on every platform, output file and `.bearings/` excluded from the fingerprint.
- detect: each kind in the table.
- extract: every export form listed in §7; Python `__all__` precedence; import resolution.
- rank: entry first, importedBy boost, tests penalised.
- render: sections present; budget honoured by the estimate at 1500, 600, 300; degradation order; byte-identical on a second build; no timestamp in the body.
- fingerprint: stable; changes on touch; unchanged by writing `BEARINGS.md`.
- cli: `build` writes both files; `check` exits 1 after a change and 0 after rebuild; `print`; `emit` returns valid hook JSON with `additionalContext` and never throws on bad stdin or a missing folder; `--version`.
- hook: install writes the right shape, idempotent, preserves unrelated hooks, uninstall removes only ours; `--global` targets the home settings; `--command` respected.
- Windows: path normalisation and CRLF manifests through the same tests (the code has no platform branches to test).
- regressions (`test/regressions.test.mjs`): every bug the 0.1.0 adversarial review reproduced — cubic backtracking in the JS import regex, `[Bb]in/` character classes and BOM'd `.gitignore`, backslash hook commands, `init` leaving a stale map, read-only folders, `--out` absolute paths, `.claude/settings.local.json` churn.

### What `check` is for

The fingerprint is mtime-based, so `check` is a local gate (pre-commit, a watcher, "did I forget to rebuild") — not a CI assertion. A fresh clone has new mtimes and no `.bearings/state.json`, so `check` will always say stale there; CI should run `build` and, if it wants a diff, compare everything above the footer.

### Why Recent comes from git

mtimes are not a property of the tree. A clone, a checkout, a merge or a `git stash pop` restamps them, in whatever order the files happen to be written, so ranking by mtime rendered the *same commit* differently on different machines — a map that churned without the project changing, against the rule that the map stays deterministic.

When a repository is present, `src/git.mjs` walks the first-parent commit chain and diffs each commit's tree against its parent, newest first, until it has five paths. Everyone who checks out that commit gets the same five. Without a repository (or before the first commit) it falls back to mtimes, which is the best available answer there.

It reads `.git` directly rather than shelling out: loose objects and packfiles, including OFS_DELTA and REF_DELTA chains, because a fresh clone keeps everything in a pack — the case that was broken. Object bodies are zlib streams and zlib is stdlib, so this stays zero-dependency and subprocess-free. Every entry point returns null instead of throwing; a map is never worth failing a session for.

## 13. Prior art

| Tool | What it maps | Runtime | Delivery |
|------|--------------|---------|----------|
| aider repo map | signatures + PageRank | inside aider (Python, tree-sitter) | aider only |
| fkenmar/atlas | signatures, imports, PageRank, diff | Rust binary / pipx | CLI, MCP |
| raymondchins/agentmap | TS/JS import graph, blast radius | Node + ts-morph | CLI, MCP, hooks, skills |
| ariadoss/repomap | tree-sitter outline, 40 languages | Python | slash command |
| **Bearings** | orientation: what/how/where/rules, then names | Node, zero deps | SessionStart hook, auto-fresh |

Bearings is the map you read before those maps. The two compose: put `agentmap`'s query line in your CLAUDE.md and Bearings will list it under Rules.

## 14. Measuring it

The claim is that Bearings cuts the startup tax. Glassbox already measures it: the tool calls and dollars a session spends before its first write. `docs/MEASURING.md` gives the protocol — ten sessions without the hook, ten with, same project, compare `exploratory calls before first write` and cost. The number, not the feature, is the launch story.

## 15. Open questions for 0.2

- Language extractors beyond the four (Ruby, PHP, Java, C#, Swift) — each is a contributor-sized PR against `src/extract/`.
- A `--focus PATH` that spends the budget around a subtree (for monorepos).
- An MCP tool `bearings.map` for agents that prefer pulling to being pushed.
- `bearings hook install --for codex|cursor|gemini` writing the pointer files.
