# Changelog

This page mirrors [`CHANGELOG.md`](https://github.com/88plug/use-latest-version-mcp/blob/main/CHANGELOG.md)
in the repository root.

The published plugin is versioned CalVer (`YEAR.MONTH.BUILD`), auto-stamped from
the commit count by the 88plug marketplace, so every push is a uniquely
identifiable release.

## 2026.6.23

### Added

- Packaged as an 88plug Claude Code plugin: `.claude-plugin/plugin.json`
  (MCP server entry), a robust Node bootstrap launcher (`scripts/mcp-server.sh`),
  a self-marketplace manifest, a paste-ready hub entry, a full documentation
  website (MkDocs → GitHub Pages), CI (Node + Bun tests, strict docs build),
  the 88plug plugin validator, Dependabot, and issue/PR templates.
- `test-mcp-e2e.js`: full-protocol live eval driving all 15 tools end-to-end.

### Notes

- Four previously-unreachable modules are now exposed as MCP tools:
  `resolve_conflicts`, `optimize_versions`, `validate_upgrade_plan`,
  `apply_upgrades` (15 tools total).
- License is FSL-1.1-ALv2 (converts to Apache-2.0 two years after each release).
