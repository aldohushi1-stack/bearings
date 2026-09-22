# Launch copy — Bearings 0.1.0

No hashtags (they've stopped working on LinkedIn); keywords go in the opening line.

Two ways to lead. B is the one that matches the measurements; A is the one that sounds like every other launch.

## LinkedIn — option B (recommended): the honest number

Claude Code, Codex, Cursor: I built a tool to cut the "startup tax" — the ls, cat package.json, read the README dance every session starts with — and then I measured it on my own sessions before saying anything.

The result: on 28 of my sessions, 30 turns out of 2,635 did nothing but orient. That's 1.1 %, $1.51. Carrying the map that replaces them would have cost $1.42. A wash, in dollars.

So why ship it? Because the 30 round-trips are real, and because my sessions are the easy case — folders the agent wrote itself minutes earlier. The tax lives in codebases you didn't write: the client repo, the monorepo with forty packages, the new hire's first week. That number is still to be measured, and the ruler ships in the box.

npx get-bearings init

One command. A ~1,500-token map of the project — what it is, how to run and test it, where things live, which rules to read — in context at every session start, resume and compaction, rebuilt only when the folder changes. Zero dependencies, no network, never reads .env, never blocks a session.

Every other tool in this space quotes a percentage. This one ships the script that computes yours. Link in the first comment.

*(first comment)* github.com/aldohushi1-stack/bearings · npm: get-bearings · the measurement: docs/MEASURING.md

## LinkedIn — option A: the pitch

Claude Code, Codex, Cursor: every session starts cold, and you pay for it.

Before an agent does any work it spends its first 10–20 tool calls finding its bearings. ls. cat package.json. Read the README. Grep for the entry point. Work out the test command. Same answers every session, because the project hasn't changed.

Glassbox showed me the bill for that. Bearings removes it.

npx get-bearings init

That's the whole install. From the next session, the agent starts with a ~1,500-token map already in context: what the project is, how to run and test it, where things live, which rules to read first, what changed recently. Re-injected after /clear, on resume and after every compaction. Rebuilt only when the folder actually changes.

It's not another symbol map — aider, atlas and agentmap do that well. It's the map you read before those: orientation, not signatures. Works on a Python package, a Go module, a pnpm monorepo, one HTML file, or a Desktop folder with thirty projects in it.

Zero dependencies. No network. Never reads .env. Never blocks a session. MIT.

Built on a Tuesday night with Claude, test-first, 49 tests, verified on express, flask, gin, vite and Glassbox itself.

Link in the first comment.

*(first comment)* github.com/aldohushi1-stack/bearings · npm: get-bearings · or as a Claude Code plugin: /plugin marketplace add aldohushi1-stack/bearings

## X (thread) — option B

1/ Built a tool to cut Claude Code's startup tax (the ls / cat package.json / README dance). Measured it on my own 28 sessions before posting.

2/ 30 of 2,635 turns did nothing but orient. 1.1 %. $1.51. Carrying the map would cost $1.42. In dollars: a wash. In round-trips: 30 fewer.

3/ My sessions are the easy case — folders the agent wrote itself. The tax lives in codebases you didn't write. That number is still to be measured. The ruler ships in the box: scripts/startup-tax.mjs

4/ npx get-bearings init — orientation map in context at every session start, resume and compaction. Zero deps, no network, never reads .env.

5/ github.com/aldohushi1-stack/bearings — run the script before you believe anyone's percentage. Including mine.

## X (thread) — option A

1/ Every Claude Code session starts cold. 10–20 tool calls just to find its bearings before it does any work. Same answers every time.

Bearings fixes that in one command:

npx get-bearings init

2/ From the next session the agent starts with a ~1,500-token orientation map in context — what this is, how to run/test it, where things live, which rules to read. Re-injected after /clear, resume and compaction. Rebuilt only when the tree changes.

3/ It's not a symbol map (aider / atlas / agentmap own that). It's the map you read *before* those. Orientation, not signatures. Zero deps, no network, never reads .env, never blocks a session.

4/ Run on express, unedited, 578 tokens: [image of the express map]

5/ github.com/aldohushi1-stack/bearings — MIT. Also a Claude Code plugin: /plugin marketplace add aldohushi1-stack/bearings

## Friday-night line

Come get a toke. Bearings is live.
