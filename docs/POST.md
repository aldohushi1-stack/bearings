# Launch copy — Bearings 0.1.0

No hashtags (they've stopped working on LinkedIn); keywords go in the opening line.

## LinkedIn

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

## X (thread)

1/ Every Claude Code session starts cold. 10–20 tool calls just to find its bearings before it does any work. Same answers every time.

Bearings fixes that in one command:

npx get-bearings init

2/ From the next session the agent starts with a ~1,500-token orientation map in context — what this is, how to run/test it, where things live, which rules to read. Re-injected after /clear, resume and compaction. Rebuilt only when the tree changes.

3/ It's not a symbol map (aider / atlas / agentmap own that). It's the map you read *before* those. Orientation, not signatures. Zero deps, no network, never reads .env, never blocks a session.

4/ Run on express, unedited, 578 tokens: [image of the express map]

5/ github.com/aldohushi1-stack/bearings — MIT. Also a Claude Code plugin: /plugin marketplace add aldohushi1-stack/bearings

## Friday-night line

Come get a toke. Bearings is live.
