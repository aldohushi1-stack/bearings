# Measuring the startup tax

Bearings claims one thing: an agent that starts with the map in context spends fewer tool calls, fewer tokens and fewer dollars getting oriented. This is how to check that claim on your own project with [Glassbox](https://github.com/aldohushi1-stack/glassbox), which reads Claude Code transcripts and reports what each session did before it did anything useful.

## Definition

**Startup tax** — everything a session spends before its first *write*: the reads, directory listings, greps and shell commands that only establish where things are, plus the tokens and dollars they cost. Measured per session as:

- `exploratory calls before first write` — count of `Read`, `Glob`, `Grep`, `LS`/`ls`, `cat`, `find`, `head` and similar calls that precede the first `Edit`, `Write`, `MultiEdit` or state-changing `Bash`.
- `cost before first write` — the dollar cost of those turns at list price.
- `turns to first write` — how many assistant turns it took.

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

On a mid-sized Node or Python project the baseline is typically 8–20 exploratory calls and 2–4 turns before the first write. With the map in context, a well-behaved agent goes to the right file in 1–3 calls. The difference in dollars is small per session and large per month; the difference in *turns* is what you feel.

## Report it

If you run the protocol, open an issue with the two medians, the project kind and the budget you used. Real numbers from real projects are the roadmap.
