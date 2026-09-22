# Changelog

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
- 49 tests, zero dependencies, Node ≥ 20.
