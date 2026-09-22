# Bearings

**Get your bearings.** A small, budgeted orientation map of any folder, handed to your coding agent at session start.

```
npx get-bearings init
```

That's the install. From the next Claude Code session in that folder, the agent starts with a ~1,500-token map already in context: what the project is, how to run and test it, where things live, which rules to read, what changed recently. It's re-injected after `/clear`, on resume and after every context compaction, and rebuilt only when the folder actually changes.

Zero dependencies. Node ≥ 20. No network, no subprocesses, nothing leaves the machine.

## Why

Every agent session starts cold. Before it does any work, the agent spends its first ten or twenty tool calls finding its bearings — `ls`, `cat package.json`, read the README, grep for the entry point, work out the test command, discover the package manager. [Glassbox](https://github.com/aldohushi1-stack/glassbox) calls this the **startup tax**. You pay it on every new session, again on resume, and again after every compaction, and the answers are the same every time because the project hasn't changed.

The existing fixes are *symbol* maps — aider's repo map, `atlas`, `agentmap`, `/repomap`. They answer the second question (what functions exist, who imports whom). Bearings answers the first one — *what is this and how do I work in it* — and puts the answer in front of the agent without being asked.

## What the map looks like

This is Bearings run on [expressjs/express](https://github.com/expressjs/express), unedited, 578 tokens:

```markdown
# express

Fast, unopinionated, minimalist web framework

**Kind:** node-library (Node library) · **Languages:** JavaScript (141), HTML (8), YAML (7), CSS (4) · **Package manager:** npm · **Modules:** CJS · **License:** MIT · **Branch:** master · **Files:** 214

## Run & test
- `npm run lint` — eslint .
- `npm run lint:fix` — eslint . --fix
- `npm test` — mocha --require test/support/env --reporter spec --check-leaks test/ test/acceptance/
- `npm run test-ci` — nyc --exclude examples --exclude test --exclude benchmarks --reporter=lcovonly --report…
- `npm run test-cov` — nyc --exclude examples --exclude test --exclude benchmarks --reporter=html --reporter=t…
- `npm run test-tap` — mocha --require test/support/env --reporter tap --check-leaks test/ test/acceptance/
- Tests: mocha in test/ · Lint/format: eslint · CI: ci.yml, codeql.yml, legacy.yml, npm-publish.yml, scorecard.yml

## Entry points
- index.js

## Rules
- Indent: 2 spaces · 1 credential-looking file (not listed)

## Layout
- test/ — 112 files · js · tests
  - fixtures/ (21), acceptance/ (18), support/ (3) · 70 files directly
- examples/ — 80 files · js · examples
  - mvc/ (15), route-separation/ (12), error-pages/ (6), ejs/ (5), auth/ (4), downloads/ (4), +19 more · 1 file directly
- .github/ — 6 files · yml · config
  - workflows/ (5) · 1 file directly
- lib/ — 6 files · js · source
- 10 files at the root
- Skipped: .git

## Modules
- lib/utils.js — methods, etag, wetag, normalizeType, normalizeTypes, compileETag, compileQueryParser, compileTrust, setCharset
- index.js — default
- lib/express.js — default, application, request, response, Route, Router, json, raw, static, text, urlencoded
- lib/application.js — (no exports)
- lib/request.js — default
- lib/response.js — default
- lib/view.js — default
- +134 more source files

## Recent
- test/support/tmpl.js, test/support/utils.js, test/utils.js, test/fixtures/users/tobi.txt, test/middleware.basic.js

---
bearings 0.1.0 · fingerprint cc3fb683 · budget 1500 · est. 578 tokens
```

This repository's own map is in [BEARINGS.md](BEARINGS.md). It works just as well on a Python package, a Go module, a Rust crate, a pnpm monorepo (packages grouped by folder), a single HTML file, a docs folder, or a Desktop folder holding thirty unrelated projects — each gets a map shaped for what it is.

## Install

**Per project** (recommended — the map and the hook travel with the repo):

```
cd your-project
npx get-bearings init
```

This writes `BEARINGS.md`, a `.bearings/state.json` fingerprint, and adds a `SessionStart` hook to `.claude/settings.json`:

```json
{ "hooks": { "SessionStart": [ { "matcher": "startup|resume|clear|compact",
  "hooks": [ { "type": "command", "command": "npx -y get-bearings emit", "timeout": 30 } ] } ] } }
```

Commit `BEARINGS.md` or add it to `.gitignore` — either is fine. It has no timestamps and its fingerprint is over file contents, not mtimes, so the same commit produces the same file on every machine.

**For every project** (one hook in `~/.claude/settings.json`):

```
npm i -g get-bearings
bearings hook install --global --command bearings
```

**As a Claude Code plugin** (no settings edits, no `npx` at session start):

```
/plugin marketplace add aldohushi1-stack/bearings
/plugin install bearings@get-bearings
```

**Other agents** — the map is a Markdown file, so point them at it:

- Codex: add `Read BEARINGS.md before exploring the tree.` to `AGENTS.md`
- Cursor: `.cursor/rules/bearings.mdc` with `@BEARINGS.md`
- Gemini CLI: the same line in `GEMINI.md`
- Anything else: `bearings print | pbcopy`, or run `bearings watch` and read the file

## CLI

```
bearings                        build BEARINGS.md for the current folder
bearings build [DIR] [--budget N] [--out FILE] [--json] [--print] [--quiet] [--force]
bearings print [DIR]            print the map (rebuilds first if stale)
bearings check [DIR]            exit 1 if the map is stale  (CI gate)
bearings init [DIR]             build + install the Claude Code hook for this project
bearings hook install [--global] [--command CMD] [--budget N]
bearings hook uninstall [--global]
bearings emit                   hook entry point: stdin JSON in, hook JSON out (never fails)
bearings watch [DIR]            rebuild on change
```

`--budget 0` means unlimited. `--json` also writes `.bearings/map.json` with the full model (kind, scripts, entries, ranked modules with scores) for your own tooling. `check` works as a pre-commit gate and in CI: the fingerprint is over file contents, and on a fresh clone — where `.bearings/` is gitignored and absent — it falls back to the fingerprint the committed map carries in its footer.

## How it works

1. **Scan** — a breadth-first, sorted walk of the folder. Honours `.gitignore` (root and nested) and `.bearingsignore`, skips the usual junk (`node_modules`, `dist`, `.venv`, `target`, …), never follows symlinks, caps at 20,000 entries and depth 8 so a huge monorepo still returns in about a second. Binary and media files are counted, never read.
2. **Detect** — reads the manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`), the README, `Makefile`/`justfile` targets, CI workflow names, `.editorconfig`, `tsconfig`, the license, and the *keys* of `.env.example`. Guesses the kind (`node-cli`, `python-package`, `monorepo`, `folder-of-projects`, `single-file-web`, `docs`, …) from a rule table, finds entry points, and notices the rule files an agent should read first (`CLAUDE.md`, `AGENTS.md`, Cursor rules, `CONTRIBUTING`).
3. **Extract** — names, not signatures. Regex extractors for JS/TS (every `export` form plus CommonJS), Python (`def`/`class`/`__all__`/`__init__` re-exports), Go (capitalised) and Rust (`pub`). Imports are resolved to project files to count who-imports-whom.
4. **Rank** — `10·entry + 2·importedBy + 1·inSrc − depth − 5·test − 3·config − 4·example`, ties by path. Test helpers imported by tests don't count.
5. **Render within budget** — identity, run & test, entry points and rules are always kept. When the estimate is over budget the renderer degrades in a fixed order: trim modules, drop recent, flatten layout, truncate script lists, truncate layout, shorten the description. The footer records the estimate so you can see how close to the budget the map sits.
6. **Stay fresh** — a SHA-256 over every file's path, size and contents (assets and `.env` by path and size alone; nothing hashed past 256 KB). `emit` and `print` rebuild only when it changed; `check` exits 1 when it has. No watcher needed, though `watch` exists.

Full design notes, including the degradation order and the prior-art comparison, are in [DESIGN.md](DESIGN.md).

## Safety

- Reads only. Writes `BEARINGS.md` (or `--out`) and `.bearings/state.json`, nothing else.
- Never runs project code, `git`, or anything on the network.
- `.env` is never read. `.env.example` contributes key names only. Files that look like credentials (`id_rsa`, `*.pem`, `*.key`, `credentials*`, `secrets*`, `.npmrc`, …) are counted, never named.
- The hook always exits 0 and prints nothing on any error — a mapping tool must never block a session.
- The map's text is drawn from your own manifests, script names, symbol names and the README's first paragraph — the same text the agent would read anyway — so it adds no prompt-injection surface the project didn't already have.

## Measuring it

The claim is that Bearings cuts the startup tax, so it ships with the ruler: `scripts/startup-tax.mjs` reads your Claude Code transcripts and counts the turns that did nothing but orient, what they cost, and what carrying the map would have cost instead. First real result, on 28 of the author's own sessions: 30 orientation-only turns out of 2,635 (1.1 %, $1.51) against $1.42 to carry the map — a wash in dollars, one round-trip saved per session. Those were sessions in folders the agent had written itself; the number for codebases you did not write is the one worth having, and [docs/MEASURING.md](docs/MEASURING.md) is the protocol for getting it. Run it before you believe anyone's percentage, including this README's.

## Contributing

The two tables contributors most want to extend are `src/detect.mjs` (the kind rules) and `src/extract/` (one file per language — Ruby, PHP, Java, C#, Swift are all one regex-and-a-test away). Run `npm test`; every feature has fixtures under `test/fixtures/`. A PR that adds a language should add a fixture and a `test/extract.test.mjs` case.

## Prior art

| Tool | What it maps | Runtime | Delivery |
|------|--------------|---------|----------|
| aider repo map | signatures + PageRank | inside aider (Python, tree-sitter) | aider only |
| [fkenmar/atlas](https://github.com/fkenmar/atlas) | signatures, imports, PageRank, diff | Rust binary / pipx | CLI, MCP |
| [raymondchins/agentmap](https://github.com/raymondchins/agentmap) | TS/JS import graph, blast radius | Node + ts-morph | CLI, MCP, hooks, skills |
| [ariadoss/repomap](https://github.com/ariadoss/repomap) | tree-sitter outline, 40 languages | Python | slash command |
| **Bearings** | orientation: what / how / where / rules, then names | Node, zero deps | SessionStart hook, auto-fresh |

Bearings is the map you read before those maps. They compose: put agentmap's query line in your `CLAUDE.md` and Bearings will list it under Rules.

## License

MIT © Aldo Hushi
