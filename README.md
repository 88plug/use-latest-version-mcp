<div align="center">

# use-latest-version-mcp

**MCP server for always-current package versions and dependency upgrades** — 15 tools across 39 registries for Claude Code, AI coding assistants, and any Model Context Protocol client.

[![plugin-validate](https://github.com/88plug/use-latest-version-mcp/actions/workflows/plugin-validate.yml/badge.svg)](https://github.com/88plug/use-latest-version-mcp/actions/workflows/plugin-validate.yml)
[![License: FSL-1.1-ALv2](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue?style=flat)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-online-blue?style=flat)](https://88plug.github.io/use-latest-version-mcp/)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A2BE2?style=flat)](https://github.com/88plug/claude-code-plugins)
[![DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/88plug/use-latest-version-mcp)

[Docs](https://88plug.github.io/use-latest-version-mcp/) ·
[Install](https://88plug.github.io/use-latest-version-mcp/installation/) ·
[Tools](https://88plug.github.io/use-latest-version-mcp/reference/tools/) ·
[Registries](https://88plug.github.io/use-latest-version-mcp/reference/registries/)

</div>

## Install

```text
/plugin marketplace add 88plug/claude-code-plugins
/plugin install use-latest-version@88plug
```

No environment variables. No API key. On first launch the Claude Code plugin compiles itself and starts the MCP server automatically.

> [!TIP]
> Enable auto-update once (`/plugin` → Marketplaces → **88plug** → Enable auto-update) and you always get the latest at startup.

Manual, Docker, and generic MCP client setup: [Installation](https://88plug.github.io/use-latest-version-mcp/installation/).

## Quickstart

After install, ask your agent:

```text
What's the latest version of express on npm?
Is requests==2.28.0 current on PyPI?
Scan this project and report outdated dependencies.
Plan upgrades, validate the plan, then dry-run apply.
```

| You say | Tool |
| --- | --- |
| Latest version of a package | `get_latest_version` |
| Version + description / homepage / publish date | `get_package_info` |
| Ready-to-run install command | `get_install_command` |
| Is my pin still current? (semver) | `compare_versions` |
| Inventory manifests + lock files | `scan_project` |
| Outdated report with risk | `check_outdated` |
| Plan → validate → apply (dry-run default) | `optimize_versions` → `validate_upgrade_plan` → `apply_upgrades` |

You get live registry answers in the same turn — not versions from training data.

## Why

An LLM's training cutoff freezes package versions. Left alone, AI agents and developer-tools workflows write pins that were current *then*. This MCP server queries each package registry on demand, then can inventory a repo, reason about semver and conflicts, and run a safe upgrade pipeline for package management and versioning work.

Built for Claude Code and other Anthropic / LLM agent setups that speak the Model Context Protocol. Use it whenever productivity depends on accurate dependency truth — codegen, migrations, audits, and automation.

## Features

| Feature | Detail |
| --- | --- |
| Live version lookup | Latest version, package info, install command, batch checks |
| Semver compare | Pin vs latest: `update-available` / `up-to-date` / `ahead-of-latest` |
| Project scan | Manifests + lock files (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, …) |
| Outdated report | Major / minor / patch + estimated risk |
| Conflict reasoning | Compatibility, detect conflicts, find compatible version, upgrade path |
| Safe upgrade pipeline | `optimize_versions` → `validate_upgrade_plan` → `apply_upgrades` |
| Write safety | Only `apply_upgrades` writes; `dry_run: true` by default; backups + rollback |
| 39 registries | npm, PyPI, Maven, crates.io, Go, Docker/GHCR, Homebrew, and more |
| Local-first MCP | No API key; optional `GITHUB_TOKEN` only raises GitHub rate limits |

## MCP tools

15 tools total. Full argument lists: [Tool Reference](https://88plug.github.io/use-latest-version-mcp/reference/tools/).

| Capability | Tools |
| --- | --- |
| Lookup + install + semver | `get_latest_version`, `get_package_info`, `get_install_command`, `compare_versions`, `check_multiple_packages` |
| Project scan / outdated | `scan_project`, `check_outdated` |
| Conflicts / compatibility | `check_compatibility`, `detect_conflicts`, `find_compatible_version`, `suggest_upgrade_path`, `resolve_conflicts` |
| Plan → validate → apply | `optimize_versions`, `validate_upgrade_plan`, `apply_upgrades` |

## Upgrade pipeline

```text
optimize_versions → validate_upgrade_plan → apply_upgrades (dry_run: true by default)
```

1. **`optimize_versions`** — whole-project plan per dependency (`keep` / `upgrade` / `downgrade` / `remove`) with risk. Read-only.
2. **`validate_upgrade_plan`** — pre-flight for major bumps, cycles, and constraint violations. Read-only.
3. **`apply_upgrades`** — applies the plan to manifests. **Dry-run by default.** Pass `dry_run: false` to write. With writes, `create_backup: true` stores timestamped copies under `.dependency-backups/` and rolls back a file on error.

Related helpers: `resolve_conflicts` for cross-file pin clashes; `suggest_upgrade_path` for multi-major single-package paths.

## Registries

39 registries behind one interface: npm, PyPI, Maven, crates.io, Go, RubyGems, NuGet, Packagist, Hex, pub.dev, CRAN, CPAN, Clojars, Hackage, Dub, LuaRocks, Elm, Swift, JSR, Conda, Bioconductor, Docker Hub, GHCR, Quay, GCR, GitHub, GitLab, Homebrew, AUR, Snap, Flatpak, Chocolatey, CocoaPods, Gradle, Terraform, Ansible Galaxy, VS Code, WordPress, Jenkins.

Name formats and aliases: [Supported Registries](https://88plug.github.io/use-latest-version-mcp/reference/registries/).

## Safety

`apply_upgrades` is the only tool that writes to disk.

- Defaults to **`dry_run: true`** (preview only)
- When writing, backs up each file under `.dependency-backups/` unless `create_backup: false`
- Rolls back a file's edits on error

Everything else is read-only. Optional `GITHUB_TOKEN` only raises rate limits for `github` / `ghcr` / `swift` — never required.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | no | Higher GitHub API rate limits for `github` / `ghcr` / `swift` |
| `PORT` / `HOST` | no | HTTP transport bind (default port `3000`) |

Full HTTP and origin settings: [Configuration](https://88plug.github.io/use-latest-version-mcp/configuration/).

## Other MCP clients

Point any MCP client at the launcher (stdio):

```json
{
  "mcpServers": {
    "use-latest-version": {
      "command": "/absolute/path/to/use-latest-version-mcp/scripts/mcp-server.sh"
    }
  }
}
```

Or run the built server: `node build/index.js stdio` (or `http` for Streamable HTTP). Docker:

```sh
docker build -t use-latest-version-mcp .
docker run --rm -p 3000:3000 use-latest-version-mcp
curl localhost:3000/health
```

## Development

```sh
git clone https://github.com/88plug/use-latest-version-mcp
cd use-latest-version-mcp
npm ci
npm run build
node build/index.js stdio        # or: http
# tests
for t in test-*.js; do node "$t"; done
bun test test-upgrade-applier.test.js test-upgrade-validator.test.js
```

Docs site (Material for MkDocs, strict):

```sh
pip install mkdocs mkdocs-material
mkdocs build --strict
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[FSL-1.1-ALv2](./LICENSE) — Functional Source License, converting to Apache-2.0 two years after each release.
