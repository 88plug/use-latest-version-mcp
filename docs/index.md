# use-latest-version-mcp

Stop suggesting stale package versions. Live version truth for AI coding
assistants — across **39 registries** — plus a safe scan → optimize → validate →
apply upgrade pipeline.

[![plugin-validate](https://github.com/88plug/use-latest-version-mcp/actions/workflows/plugin-validate.yml/badge.svg)](https://github.com/88plug/use-latest-version-mcp/actions/workflows/plugin-validate.yml)
[![License: FSL-1.1-ALv2](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue?style=flat)](https://github.com/88plug/use-latest-version-mcp/blob/main/LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A2BE2?style=flat)](https://github.com/88plug/claude-code-plugins)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/88plug/use-latest-version-mcp)

## Install

```sh
/plugin marketplace add 88plug/claude-code-plugins
/plugin install use-latest-version@88plug
```

### Grok Build

```text
grok plugin marketplace add 88plug/claude-code-plugins
grok plugin install use-latest-version@88plug --trust
```


No environment variables. No API keys. On first launch the plugin compiles itself
and starts the MCP server.

!!! tip
    Enable auto-update once (`/plugin` → Marketplaces → **88plug** → Enable
    auto-update) and you always get the latest at startup.

Manual, Docker, and generic MCP client setup: [Installation](installation.md).

## Quickstart

Ask the assistant:

| You say | Tool |
|---|---|
| What's the latest `express` on npm? | `get_latest_version` |
| Is `requests==2.28.0` current? | `compare_versions` |
| Scan this project for outdated deps | `check_outdated` |
| Plan an upgrade, show the diff first | `optimize_versions` → `validate_upgrade_plan` → `apply_upgrades` |

The apply step is **dry-run by default**. You only write files when you pass
`dry_run: false`. Details: [Getting Started](getting-started.md) and
[Tool Reference](reference/tools.md#apply_upgrades).

## Why it exists

A model's training data has a cutoff. Left alone it writes versions that were
current *then*. This server asks the registry every time — then can inventory,
plan, and apply dependency upgrades for a whole repo.

## What it does

| Capability | Tools |
|---|---|
| Lookup latest version + metadata, install command, semver compare | `get_latest_version`, `get_package_info`, `get_install_command`, `compare_versions`, `check_multiple_packages` |
| Project scan and outdated report | `scan_project`, `check_outdated` |
| Conflict / compatibility / upgrade path | `check_compatibility`, `detect_conflicts`, `find_compatible_version`, `suggest_upgrade_path`, `resolve_conflicts` |
| Whole-project plan → validate → apply | `optimize_versions`, `validate_upgrade_plan`, `apply_upgrades` |

**15 tools** total. Full argument lists: [Tool Reference](reference/tools.md).

## Registries

39 registries behind one interface: npm, PyPI, Maven, crates.io, Go, RubyGems,
NuGet, Packagist, Hex, pub.dev, CRAN, CPAN, Clojars, Hackage, Dub, LuaRocks,
Elm, Swift, JSR, Conda, Bioconductor, Docker Hub, GHCR, Quay, GCR, GitHub,
GitLab, Homebrew, AUR, Snap, Flatpak, Chocolatey, CocoaPods, Gradle, Terraform,
Ansible Galaxy, VS Code, WordPress, Jenkins.

Name formats and aliases: [Supported Registries](reference/registries.md).

## Safety

`apply_upgrades` is the **only** tool that writes to disk.

- Defaults to **`dry_run: true`** (preview only)
- When writing (`dry_run: false`), backs up each file under `.dependency-backups/`
  unless `create_backup: false`
- Rolls back a file's edits on error

Everything else is read-only. Optional `GITHUB_TOKEN` only raises GitHub rate
limits for `github` / `ghcr` / `swift` — never required.

## Start here

- [Getting Started](getting-started.md) — first calls and the upgrade pipeline
- [Installation](installation.md) — plugin, standalone, Docker
- [Configuration](configuration.md) — env vars, timeouts, HTTP transport
- [Tool Reference](reference/tools.md) — all 15 tools
- [Supported Registries](reference/registries.md) — 39 registries
- [FAQ](faq.md)
