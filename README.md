<div align="center">

# use-latest-version-mcp

**Stop suggesting stale package versions.** Live version truth for AI coding
assistants — across 39 registries — plus a safe scan → optimize → validate →
apply upgrade pipeline.

[![plugin-validate](https://github.com/88plug/use-latest-version-mcp/actions/workflows/plugin-validate.yml/badge.svg)](https://github.com/88plug/use-latest-version-mcp/actions/workflows/plugin-validate.yml)
[![License: FSL-1.1-ALv2](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue?style=flat)](LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-online-blue?style=flat)](https://88plug.github.io/use-latest-version-mcp/)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A2BE2?style=flat)](https://github.com/88plug/claude-code-plugins)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/88plug/use-latest-version-mcp)

[Docs](https://88plug.github.io/use-latest-version-mcp/) · [Tool reference](https://88plug.github.io/use-latest-version-mcp/reference/tools/) · [Registries](https://88plug.github.io/use-latest-version-mcp/reference/registries/)

</div>

---

## Install

```sh
# 1. Add the marketplace (once per machine)
/plugin marketplace add 88plug/claude-code-plugins

# 2. Install the plugin
/plugin install use-latest-version@88plug
```

No environment variables, no API keys. On first launch it compiles itself and
starts the MCP server automatically.

> [!TIP]
> Enable auto-update once (`/plugin` → Marketplaces → **88plug** → Enable
> auto-update) and you always get the latest at startup.

## Why

A model's training data has a cutoff; left alone it writes versions that were
current *then*. This server gives it ground truth — it asks the registry, every
time — and can inventory, plan, and apply dependency upgrades for a whole repo.

## What it does

- **Look up** latest version + metadata, generate the install command, and
  compare a version you hold against the latest (semver-aware).
- **Scan** a project's manifests and lock files and report what's **outdated**
  with upgrade type and risk.
- **Reason**: detect conflicting constraints, check compatibility, find the
  highest version satisfying constraints, build a multi-major upgrade path.
- **Optimize → validate → apply**: a whole-project upgrade plan, validated for
  breaking changes and cycles, written to the manifests — **dry-run by default,
  with automatic backups** when it does write.

15 tools in total — see the [Tool Reference](https://88plug.github.io/use-latest-version-mcp/reference/tools/).

## Registries

39 registries behind one interface: npm, PyPI, Maven, crates.io, Go, RubyGems,
NuGet, Packagist, Hex, pub.dev, CRAN, CPAN, Clojars, Hackage, Dub, LuaRocks,
Elm, Swift, JSR, Conda, Bioconductor, Docker Hub, GHCR, Quay, GCR, GitHub,
GitLab, Homebrew, AUR, Snap, Flatpak, Chocolatey, CocoaPods, Gradle, Terraform,
Ansible Galaxy, VS Code, WordPress, Jenkins. Full table with name formats:
[Supported Registries](https://88plug.github.io/use-latest-version-mcp/reference/registries/).

## Safety

`apply_upgrades` is the only tool that writes to disk. It defaults to a **dry
run**, backs up every file it touches to `.dependency-backups/`, and rolls back
on error. Everything else is read-only.

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

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[FSL-1.1-ALv2](./LICENSE.md) — Functional Source License, converting to
Apache-2.0 two years after each release.
