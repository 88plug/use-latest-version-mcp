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

## License of contributions

By contributing you agree your contribution is licensed under the project's
[FSL-1.1-ALv2](./LICENSE.md). PRs to IP-bearing 88plug repos may trigger a CLA
check; sign once and future PRs auto-pass.

Questions: open an issue or email andrew@88plug.com.
