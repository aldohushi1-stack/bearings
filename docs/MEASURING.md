# Measuring the startup tax

Bearings claims one thing: an agent that starts with the map in context spends fewer tool calls, fewer tokens and fewer dollars getting oriented. This is how to check that claim on your own project with [Glassbox](https://github.com/aldohushi1-stack/glassbox), which reads Claude Code transcripts and reports what each session did before it did anything useful.

## Definition

**Startup tax** — everything a session spends before its first *write*: the reads, directory listings, greps and shell commands that only establish where things are, plus the tokens and dollars they cost. Measured per session as:

- `exploratory calls before first write` — count of `Read`, `Glob`, `Grep`, `LS`/`ls`, `cat`, `find`, `head` and similar calls that precede the first `Edit`, `Write`, `MultiEdit` or state-changing `Bash`.
- `cost before first write` — the dollar cost of those turns at list price.
- `turns to first write` — how many assistant turns it took.

## The script

`scripts/startup-tax.mjs` does the counting. Zero dependencies, reads only.

```
node scripts/startup-tax.mjs ~/.claude/projects            # every session
node scripts/startup-tax.mjs ~/.claude/projects --since 2026-09-23 --per-session
node scripts/startup-tax.mjs ~/.claude/projects --format json > startup-tax.json
```

It reports, per session and in aggregate: exploratory calls before the first write; how many of those are *orientation* calls — the ones a map answers (directory listings, manifests, README, rule files, git status/log, toolchain versions, scoped to the project folder); turns, tokens and dollars before the first write; orientation calls and orientation-only turns across the whole session; the estimated cost of carrying a 1,500-token map through those same sessions; and what kept getting read. Costs use the same list-price card as Glassbox and count each streamed turn once. On Windows, `scripts\measure.cmd` runs it and writes the report into `docs\private\`.

## Baseline: 28 real sessions, before the hook

Run on Aldo's own Claude Code transcripts (Jul–Sep 2026, 2,635 turns, $287.59): **30 turns did nothing but orient — 1.1 % of turns, $1.51 — and carrying the map would have cost $1.42.** In dollars it is a wash on that corpus; the gain is one fewer round-trip per session. Those sessions are mostly new builds and research in folders the agent wrote itself, so the tax was always going to be small there. The full report and the interpretation are in [baseline-2026-09.md](baseline-2026-09.md). The number that matters — for codebases the agent did not write — is still to be measured, and the protocol below is how.

## Protocol

1. Pick one real project you work on daily and one repeatable task shape — "fix a bug you describe in one line", "add a small feature", "explain how X works". Vary the task, keep the shape.
2. **Baseline.** With no Bearings hook installed, run ten sessions. Start each one fresh (`claude` in the project folder, no `--resume`). Do the task, stop.
3. **With Bearings.** `npx get-bearings init`, then ten more sessions of the same shape.
4. Run Glassbox over both sets:

   ```
   npx glassbox-trace check --all --since 2026-09-22 --format json > sessions.json
   ```

   For each session take the tool calls before the first write (Glassbox's timeline has the tool names and order) and the cost of those turns.
5. Compare medians, not means — one session that reads the whole tree will swamp a mean.

## What to expect

Honestly: less than the pitch. On the one corpus measured so far the dollars were a wash and the gain was one round-trip per session. On an unfamiliar, mid-sized codebase the first few turns of a session are usually `ls`, the README and the manifest, so the expectation there is 2–5 orientation calls and one or two turns saved per session — again, felt in latency more than in money. If your number is bigger, that's a real result; if it isn't, the script will say so.

## Report it

If you run the protocol, open an issue with the two medians, the project kind and the budget you used. Real numbers from real projects are the roadmap.
