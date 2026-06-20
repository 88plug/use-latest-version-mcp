# Contributing

Thanks for considering a contribution to `use-latest-version-mcp`.

## Develop

```sh
npm ci
npm run build
```

Run the server locally:

```sh
node build/index.js stdio    # MCP stdio transport
node build/index.js http     # Streamable HTTP transport on $PORT (default 3000)
```

## Tests

The suite is plain Node scripts plus two Bun-runner files. All must pass:

```sh
for t in \
  test-compatibility.js test-conflict-resolver.js test-project-scanner.js \
  test-server-factory.js test-global-version-optimizer.js test-write-path.js \
  test-dependency-parsers.js test-lock-file-parsers.js; do
  node "$t"
done
bun test test-upgrade-applier.test.js test-upgrade-validator.test.js
```

A full end-to-end check that drives all 15 tools over the MCP protocol against
live registries (network-dependent; failures there are reported as non-fatal
warnings):

```sh
node test-mcp-e2e.js
```

## Plugin validation

CI runs the 88plug plugin validator on every push. Run it locally before a PR:

```sh
python .ci/validate_plugin.py .
```

It hard-errors on a missing/invalid `.claude-plugin/plugin.json`, a
`${CLAUDE_PLUGIN_*:-default}` form in a manifest, broken shell scripts, and
malformed skill/agent frontmatter.

## Conventions

- **Add tests first** for any behavior change, then make them pass.
- Keep `scripts/mcp-server.sh` POSIX-bash clean (`bash -n` must pass) and never
  write to stdout from it — stdout is the MCP transport.
- Update the docs under `docs/` when user-facing behavior changes; `mkdocs build
  --strict` must succeed.
- Don't commit `build/` — the launcher compiles on first run.
- Commit messages: imperative mood; no AI/assistant attribution.

## Maintaining the DeepWiki index

The README's "Ask DeepWiki" badge points at `deepwiki.com/88plug/use-latest-version-mcp`.
Researched against Cognition's API, there are exactly two ways to populate it:

1. **Public page (the badge):** generated on demand; its trigger is gated by a
   Google reCAPTCHA, so there is **no key-free, captcha-free HTTP endpoint**. The
   public status endpoint is open: `GET https://api.devin.ai/ada/public_repo_indexing_status?repo_name=<owner>/<repo>`.
   Use the helper, which runs a real browser (reCAPTCHA usually passes invisibly;
   if challenged, solve it once), then polls that status API until done:

   ```sh
   npm i -D playwright && npx playwright install chromium
   node scripts/index-deepwiki.mjs            # uses CHROME_USER_DATA_DIR if set
   ```

2. **Private Devin org DeepWiki (different surface, paid):** fully scriptable —
   `PUT https://api.devin.ai/v3beta1/organizations/{org}/repositories/{path}/indexing`
   with `Authorization: Bearer cog_…` (a Devin service user with
   `IndexOrgRepositories`). This does **not** populate the free public page.

Because the public trigger is captcha-gated, this is a one-time/occasional manual
run, not CI. Re-running it refreshes the wiki after major changes.

## License of contributions

By contributing you agree your contribution is licensed under the project's
[FSL-1.1-ALv2](./LICENSE.md). PRs to IP-bearing 88plug repos may trigger a CLA
check; sign once and future PRs auto-pass.

Questions: open an issue or email andrew@88plug.com.
