# Startup tax — Aldo's Claude Code sessions, Jul–Sep 2026 (before Bearings)

28 sessions across 5 projects (deepwater-kit, sesh, claude, my-agent, Aldo) · 2,635 turns · 566,929,465 tokens · $287.59 at list price (main thread only; subagents excluded) · 18 sessions reached a first write.

## Before the first write (per session that wrote)

| metric | median | mean | total |
|---|---|---|---|
| exploratory calls | 1 | 3.9 | 71 |
| of which orientation (map-answerable) | 0 | 0.4 | 7 |
| turns to first write | 9.5 | 13 | — |
| tokens before first write | 482,781 | 906,903 | 16,324,260 |
| cost before first write | $0.42 | $0.64 | $11.55 |

Orientation share of exploratory calls before the first write: **10%**.

## Orientation calls, whole sessions

35 calls (median 0 per session, mean 1.3) returning about 11,327 tokens of listings and manifests into context.

**30 of 2,635 turns did nothing but orient** — 2,836,093 tokens, $1.51. Those are the round-trips a map in context removes outright.

Carrying a 1,500-token map through every one of these sessions (written to cache once, read back on each turn) would have cost about $1.42. Net: **$0.09** across 28 sessions, before counting the calls that partly overlap with orientation or the turns that came after.

What kept getting read:

| target | calls |
|---|---|
| ls | 14 |
| Get-ChildItem | 8 |
| which | 2 |
| Glob **/*.jsonl | 1 |
| python | 1 |
| pwd | 1 |
| README.md | 1 |
| uv | 1 |
| Glob <absolute path> | 1 |
| Glob **/backtalk.json | 1 |
| Glob **/backtalk/** | 1 |
| Glob **/backtalk* | 1 |
| where | 1 |
| find | 1 |

Definitions: a *write* is Edit/Write/MultiEdit/NotebookEdit or a shell command that creates, moves, installs or commits. *Exploratory* is Read/Glob/Grep/LS plus read-only shell. *Orientation* is the subset a Bearings map answers: directory listings, manifests, README, rule files, git status/log, tool versions. Costs use list price per million tokens; a streamed turn counts once (max per usage field).

## Reading it

This is the *before* arm. It was run on 22 September 2026 against the 35 Claude Code transcripts copied into `sesh\projects` (28 had tool calls; the rest were one-line chats). Subagent transcripts are excluded because a map is delivered to the main thread.

What it says, plainly:

- **Orientation is about one round-trip per session on this corpus.** 30 of 2,635 turns did nothing but list a directory, check a toolchain version or read a manifest inside the project. That is 1.1 % of turns and $1.51 of $287.59.
- **Carrying the map costs about the same.** A 1,500-token map, cached once and read back on every turn, would have cost $1.42 across these sessions. In dollars, on this corpus, Bearings is a wash. The gain is 30 fewer round-trips — latency and attention, not money.
- **Why so small.** These sessions are mostly new builds started from a prompt ("make me X"), research sessions, and work in folders whose `CLAUDE.md` and auto-memory already carry the orientation. The agent rarely had to *find its bearings* because it wrote the project itself minutes earlier. The startup-tax story is a story about **existing codebases you did not write** — a new hire's first week, a client repo, a monorepo with forty packages. That is a hypothesis this corpus cannot test.
- **What is not counted.** 71 exploratory reads before the first write that targeted specific source files (the task's own files) — a map does not replace those. Nor does this count reads that *partly* overlap with the Modules section, such as opening a file to see what it exports. The number above is the floor, not the ceiling.
- **First version of the classifier.** An earlier pass of the same script, before orientation was scoped to the project folder, reported 81 turns and $5.67 — because it counted listings of *other* folders (Program Files, AppData, sibling projects) that no project map answers. The scoped number is the honest one.

## The after arm

**Hook installed 22 September 2026** in `sesh` and `my-agent`, via `bearings init` with
`--command 'node "C:/Users/Aldo/Desktop/sesh/bearings/bin/bearings.mjs"'` — the package is not
published yet, so the default `npx -y get-bearings emit` would have failed silently on every
session start. Maps: sesh 1,262 tokens, my-agent 424 tokens. Build time 2.3 s and 1.2 s cold,
against a 30 s hook timeout.

Work normally for ten sessions, then:

```
node scripts/startup-tax.mjs %USERPROFILE%\.claude\projects --since 2026-09-23 --per-session
```

or double-click `scripts\measure.cmd`.

### Compare against these numbers, not the table at the top of this file

The table above was computed from the 28-session *copy* in `sesh\projects`. The after arm reads
the live `~/.claude/projects`, which by 22 Sep held **49 sessions with tool calls** — and the
per-session orientation rates there are roughly double the copy's. Comparing the after arm to the
top of this file would flatter the result. The honest before arm is every live session through
22 Sep 2026, frozen in `docs/private/before-arm-2026-09-22.{md,json}` (gitignored):

| scope | sessions | orientation calls / session | orientation-only turns / session |
|---|---|---|---|
| all projects | 49 | median 2 · mean 2.22 | median 1 · mean 1.80 |
| **sesh + my-agent** (the hooked pair) | 41 | **median 2 · mean 2.27** | **median 1 · mean 1.80** |
| sesh alone | 21 | median 2 · mean 3.57 | median 2 · mean 2.81 |
| my-agent alone | 20 | median 0 · mean 0.90 | median 0 · mean 0.75 |

Across the whole live corpus: 109 orientation calls, **88 of 5,690 turns did nothing but orient**
($17.80), against $3.89 to carry the map — net $13.91, where the copied 28-session corpus showed a
$0.09 wash. The bolded row is the one to beat. Note `my-agent` starts at a median of 0, so there
is nothing there to remove; `sesh` carries essentially all the headroom, and a combined number
that barely moves may only mean the two were averaged together.

If the after number is not lower, say so; that is a finding too.

To get the number that matters — the one for codebases the agent did not write — run the same protocol on a repository you have never opened with Claude before: clone something mid-sized (express, flask, a client project), run five sessions without the hook and five with, same task shape ("explain how X works", "add a small feature").
