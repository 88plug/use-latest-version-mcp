# Getting Started

## Install (Claude Code, via the 88plug marketplace)

```sh
# 1. Add the marketplace (once per machine)
/plugin marketplace add 88plug/claude-code-plugins

# 2. Install this plugin
/plugin install use-latest-version@88plug
```

That is all. No environment variables, no API keys. On first launch the plugin
compiles itself and starts the MCP server automatically.

## First calls

Ask your assistant things like:

- "What's the latest version of `express` on npm?" -> `get_latest_version`
- "Is `requests==2.28.0` current?" -> `compare_versions`
- "Scan this project and tell me what's outdated." -> `check_outdated`
- "Plan an upgrade for this repo, then show me the diff before applying." ->
  `optimize_versions` -> `validate_upgrade_plan` -> `apply_upgrades` (dry run)

## The upgrade pipeline

The four project tools are designed to chain:

1. `optimize_versions` — scans the project and returns a plan (per dependency:
   keep / upgrade / downgrade / remove, with risk).
2. `validate_upgrade_plan` — checks that plan for breaking (major) bumps,
   circular dependencies, and constraint violations.
3. `apply_upgrades` — writes the plan to the manifests. **Defaults to a dry
   run**; pass `dry_run: false` to actually write. Backs up every file first.

See the [Tool Reference](reference/tools.md) for every tool and its arguments.
