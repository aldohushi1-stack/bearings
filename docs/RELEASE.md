# Releasing

The first published version is **0.2.0** (0.1.0 was tagged in the changelog but never published). Everything below is Aldo's to run (or Claude via the GitHub web upload page in Chrome, as with Glassbox).

## 1. GitHub

1. Create the public repo **aldohushi1-stack/bearings** (empty, no README — we bring our own).
2. Upload the tree from `sesh\bearings`. Line endings: the repo is LF everywhere (`.gitattributes` enforces it); if files arrive CRLF from Windows, normalise before uploading.
3. Upload order if the web uploader is used one directory at a time: `src/` → `bin/` → `hooks/` + `.claude-plugin/` → `test/` → root files → `docs/` → `.github/workflows/` last (workflows can be blocked for automation; upload those by hand if so).
4. Check Actions → ci is green on the final commit (matrix: 3 OS × Node 20/22/24). The `concurrency` block cancels partial-tree runs from a multi-commit upload.
5. Settings → General → Features: enable Issues. Settings → Security: enable private vulnerability reporting. Add topics: `claude-code`, `claude-code-hooks`, `repo-map`, `coding-agents`, `context`.

## 2. npm (trusted publishing, same pattern as glassbox-trace)

1. On npmjs.com (account **aldoh**, 2FA with the security key): Packages → *get-bearings* does not exist yet — trusted publishing can only be configured **after** the first publish, so the first release goes up by hand:

   ```
   cd sesh\bearings
   npm login
   npm publish --access public
   ```

   (The name `get-bearings` was still free on 23 Sep 2026; `bearings` is taken.)
2. Then on npmjs.com → get-bearings → Settings → Publishing access → **Trusted publisher**: GitHub, owner `aldohushi1-stack`, repo `bearings`, workflow `publish.yml`. Tick "Allow npm publish".
3. From the next release: bump `version` in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (the plugin test enforces they agree), push, then Actions → publish → Run workflow (or publish a GitHub Release). Do **not** publish a GitHub Release for a version that is already on npm — the workflow would fail on the duplicate.
4. Verify: `npx get-bearings@0.2.0 --version` prints `0.2.0`; `npx get-bearings init` in any folder installs the hook.

## 3. Plugin marketplace

Nothing to publish — `/plugin marketplace add aldohushi1-stack/bearings` reads `.claude-plugin/marketplace.json` straight from the repo once it's public. Test it once from a Claude Code session: `/plugin install bearings@get-bearings`, start a new session in any project, and the map should be in context (ask "what's in this project?" — the answer should not need a single tool call).

## 4. Announce

Copy for LinkedIn and X is in `docs/POST.md`. Lead with the number from `docs/MEASURING.md` if you have run it; otherwise lead with the express map.
