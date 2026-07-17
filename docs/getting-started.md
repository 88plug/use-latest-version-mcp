# Getting Started

## Install (Claude Code)

```sh
/plugin marketplace add 88plug/claude-code-plugins
/plugin install use-latest-version@88plug
```

No environment variables. No API keys. On first launch the plugin compiles itself
and starts the MCP server.

Other install paths (manual, Docker, generic MCP config): [Installation](installation.md).

## First calls

| Goal | Tool |
|---|---|
| Latest version of a package | `get_latest_version` |
| Version + description / homepage / publish date | `get_package_info` |
| Ready-to-run install command | `get_install_command` |
| Is my pin still current? | `compare_versions` |
| Batch several packages | `check_multiple_packages` |
| Inventory manifests + lock files | `scan_project` |
| Outdated report with risk | `check_outdated` |

Example prompts:

- "What's the latest version of `express` on npm?" → `get_latest_version`
- "Is `requests==2.28.0` current on PyPI?" → `compare_versions`
- "Scan this project and tell me what's outdated." → `check_outdated`

Registry ids and package name formats: [Supported Registries](reference/registries.md).

## Upgrade pipeline (dry-run by default)

Four project tools chain together. Only the last one can write — and it does
**not** write unless you opt in.

```text
optimize_versions  →  validate_upgrade_plan  →  apply_upgrades (dry_run: true)
                                                      ↓
                                          review the preview
                                                      ↓
                                          apply_upgrades (dry_run: false)
```

1. **`optimize_versions`** — scans the project; returns a plan per dependency
   (`keep` / `upgrade` / `downgrade` / `remove`) with risk. Read-only.
2. **`validate_upgrade_plan`** — checks the plan for major bumps, cycles, and
   constraint violations. Read-only.
3. **`apply_upgrades`** — applies the plan to manifests
   (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, `pom.xml`, …).
   - `dry_run` defaults to **`true`** — computes and reports the diff, writes nothing
   - pass **`dry_run: false`** to write
   - `create_backup` defaults to **`true`** — timestamped copies under
     `.dependency-backups/` before each write; per-file rollback on error

Related helpers:

- `resolve_conflicts` — same package required at incompatible versions across files
- `suggest_upgrade_path` — multi-major path for a single package
- `check_compatibility` / `detect_conflicts` / `find_compatible_version` — pure
  constraint reasoning (some need no network)

Full argument lists and the plan item shape: [Tool Reference](reference/tools.md).
