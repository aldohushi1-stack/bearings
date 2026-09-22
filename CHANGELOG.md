# Changelog

## Unreleased

- **The fingerprint is over file contents, not mtimes.** A clone or a checkout restamps mtimes, so the same tree hashed differently on every machine: the map's footer changed without the project changing, and `check` could only say "stale" on a fresh clone. Assets and credential-looking files still contribute path and size only (`.env` is never read), and nothing is hashed past 256 KB — the ceiling the map itself reads at — so the fast path stays well ahead of a full rebuild.
- **`check` is now a real CI gate.** With no `.bearings/state.json` — the normal state of a fresh clone, since it is gitignored — it falls back to the fingerprint the committed map carries in its own footer.

- **Recent comes from the commit history when there is a repository.** It was the five newest mtimes, which a clone or checkout restamps, so the same commit rendered a different map on every machine. `src/git.mjs` reads `.git` directly — loose objects and packfiles with delta chains — with no subprocess and no dependency, and falls back to mtimes when there is no repository or no commit yet.
- CI's hook smoke test built its payload with `$PWD`, which under `shell: bash` on windows-latest is a POSIX path Node cannot resolve; `emit` swallowed the error and the piped `JSON.parse` died. The payload is built in Node now.

## 0.1.0 — 2026-09-22

First release.

- `bearings build` — a budgeted orientation map (`BEARINGS.md`) of any folder: identity, run & test, entry points, rules, layout, ranked modules, recent files. Default budget 1,500 tokens with a fixed degradation order.
- Kinds: node-cli / node-web / node-server / node-library, python-package / python-scripts, rust, go, monorepo (packages grouped by folder, workspace globs honoured), folder-of-projects, static-site, single-file-web, docs, mixed, empty.
- Extractors for JS/TS (all `export` forms + CommonJS), Python (`def`/`class`/`__all__`/`__init__` re-exports, module-level names), Go, Rust. Import resolution for importedBy ranking.
- `bearings init` — build + Claude Code `SessionStart` hook (startup, resume, clear, compact) in `.claude/settings.json`; `hook install --global`, `hook uninstall`.
- `bearings emit` — hook entry point; never fails a session.
- `bearings check` — CI gate; `print`, `watch`, `--json`.
- Claude Code plugin (`/plugin marketplace add aldohushi1-stack/bearings`, `/plugin install bearings@get-bearings`).
- Honours `.gitignore` (root + nested) and `.bearingsignore`; breadth-first walk with 20,000-entry / depth-8 caps; never reads `.env` or credential-looking files.
- `scripts/startup-tax.mjs` — measures the startup tax from Claude Code transcripts (orientation calls, orientation-only turns, cost before first write, cost of carrying the map); `scripts/measure.cmd` for Windows; baseline on 28 real sessions in `docs/baseline-2026-09.md`.
- 62 tests (including regressions from an adversarial review: linear import regexes, gitignore character classes and BOMs, read-only folders, stdin held open, no home directory), zero dependencies, Node ≥ 20.
