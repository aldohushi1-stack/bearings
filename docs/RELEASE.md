# Releasing

The first published version is **0.2.0** (0.1.0 was tagged in the changelog but never published). Everything below is Aldo's to run (or Claude via the GitHub web upload page in Chrome, as with Glassbox).

## 1. GitHub — done 23 Sep 2026

The repo is live at github.com/aldohushi1-stack/bearings (main + tag v0.2.0, pushed from `sesh\bearings`). Day-to-day: `push.cmd` commits whatever changed in the folder and pushes it. CI run #1 was 8/9 (windows-latest / Node 20 failed on the test glob — fixed by `scripts/test.mjs`); the next push should be 9/9.

Still to do on GitHub, once: Settings → General → Features: enable Issues. Settings → Security: enable private vulnerability reporting. Add topics: `claude-code`, `claude-code-hooks`, `repo-map`, `coding-agents`, `context`.

## 2. npm (trusted publishing, same pattern as glassbox-trace)

1. On npmjs.com (account **aldoh**, 2FA with the security key): Packages → *get-bearings* does not exist yet — trusted publishing can only be configured **after** the first publish, so the first release goes up by hand:

   ```
   cd sesh\bearings
   npm login
   npm publish --access public
   ```

   or double-click `publish.cmd`, which does login (if needed) → `npm test` → `npm pack --dry-run` → `npm publish --access public` → `npx get-bearings@0.2.0 --version`, using `call npm` so the window stays open.

   (The name `get-bearings` was still free on 23 Sep 2026; `bearings` is taken.)
2. Then on npmjs.com → get-bearings → Settings → Publishing access → **Trusted publisher**: GitHub, owner `aldohushi1-stack`, repo `bearings`, workflow `publish.yml`. Tick "Allow npm publish".
3. From the next release: bump `version` in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (the plugin test enforces they agree), push, then Actions → publish → Run workflow (or publish a GitHub Release). Do **not** publish a GitHub Release for a version that is already on npm — the workflow would fail on the duplicate.
4. Verify: `npx get-bearings@0.2.0 --version` prints `0.2.0`; `npx get-bearings init` in any folder installs the hook.

## 3. Plugin marketplace

Nothing to publish — `/plugin marketplace add aldohushi1-stack/bearings` reads `.claude-plugin/marketplace.json` straight from the repo once it's public. Test it once from a Claude Code session: `/plugin install bearings@get-bearings`, start a new session in any project, and the map should be in context (ask "what's in this project?" — the answer should not need a single tool call).

## 4. Announce

Copy for LinkedIn and X is in `docs/POST.md`: option C (the fridge note) to lead, option B (the honest number) as the follow-up post once the after arm has ten sessions. Post only after `npx get-bearings init` resolves on npm — the copy tells people to run it.

## Tonight's order

1. `push.cmd` → Actions → ci: nine green.
2. `publish.cmd` → `npx get-bearings@0.2.0 --version` prints 0.2.0.
3. Trusted publisher on npmjs.com (step 2.2 above) so the next release is a workflow run.
4. Plugin smoke test (section 3) — this works already, it reads the repo, not npm.
5. Post option C.
