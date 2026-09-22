# Bearings — notes for agents

- Zero dependencies is a feature. Do not add a package to `dependencies` or `devDependencies`.
- Tests first: `npm test` (node:test, `test/*.test.mjs`). Add a fixture under `test/fixtures/` for any new kind or language.
- Design decisions live in `DESIGN.md`; update the relevant section when behaviour changes.
- The map must stay deterministic: no timestamps or absolute paths in `BEARINGS.md`; sorted iteration everywhere.
- The hook (`bearings emit`) must never exit non-zero or print anything but hook JSON.
- Run `npm run self` after changes to see this repo's own map, and commit the updated `BEARINGS.md`. Recent comes from the commit history, so a map committed in the commit it describes lags by one: rebuild and commit it again and it settles.
