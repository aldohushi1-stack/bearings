# get-bearings

Get your bearings. A small, budgeted orientation map of any folder, handed to your coding agent at session start.

**Kind:** node-cli (Node CLI) · **Languages:** JavaScript (40), Markdown (15), JSON (10), Python (5) · **Package manager:** npm · **Modules:** ESM · **License:** MIT · **Branch:** main · **Files:** 92

## Run & test
- `npm test` — node scripts/test.mjs
- `npm run self` — node bin/bearings.mjs build . --print
- `npm run check` — node bin/bearings.mjs check .
- Tests: node:test in test/ · CI: ci.yml, publish.yml

## Entry points
- bin/bearings.mjs (bin: bearings)
- src/build.mjs (main)

## Rules
- Read first: CLAUDE.md
- 1 .env file in the tree (not read)

## Layout
- test/ — 54 files · mjs · tests
  - fixtures/ (42) · 12 files directly
- src/ — 17 files · mjs · source
  - extract/ (5) · 12 files directly
- docs/ — 4 files · md · docs
- scripts/ — 3 files · mjs · scripts
- .claude-plugin/ — 2 files · json
- .github/ — 2 files · yml · config
- bin/ — 1 file · mjs · scripts
- hooks/ — 1 file · json
- 8 files at the root
- Skipped: .git · nested dist, node_modules

## Modules
- src/build.mjs — DEFAULT_BUDGET, DEFAULT_OUT, packageVersion, buildModel, statePath, readState, isStale, build
- src/scan.mjs — DEFAULT_IGNORE_DIRS, extOf, isSensitiveName, compileIgnore, matchesIgnore, scan, filesOf
- bin/bearings.mjs — (entry script)
- src/cli.mjs — main
- src/hook.mjs — HOOK_MATCHER, DEFAULT_COMMAND, HOOK_TIMEOUT, isOurs, findOurHooks, buildCommand, installHook, uninstallHook, hookOutput
- src/detect.mjs — detect
- src/render.mjs — render
- src/tokens.mjs — estimateTokens
- src/fingerprint.mjs — fingerprint
- src/git.mjs — gitDir, recentFromGit
- src/graph.mjs — resolveImport, importedBy
- src/rank.mjs — rankModules
- src/extract/index.mjs — languageOf, extractFile
- src/extract/js.mjs — extractJs
- src/extract/rust.mjs — extractRust
- src/watch.mjs — watch
- src/extract/go.mjs — extractGo
- src/extract/python.mjs — extractPython
- +29 more source files

## Recent
- .claude-plugin/marketplace.json, .claude-plugin/plugin.json, .github/workflows/ci.yml, .gitignore, CHANGELOG.md

---
bearings 0.2.0 · fingerprint a4405d03 · budget 1500 · est. 630 tokens
