# use-latest-version-mcp

An MCP server that keeps an AI coding assistant from suggesting **stale package
versions out of its training data**. It looks up the current version of any
package — across 39 registries — and analyzes, plans, and (optionally) applies
dependency upgrades for a whole project.

## Why it exists

A model's training data has a cutoff. Left to itself it will confidently write
`express@4.18.0` or `requests==2.28.0` long after those are old. This server
gives the model live ground truth: it asks the registry, every time.

## What it does

- **Look up** the latest version and metadata for a package on any supported
  registry, generate the exact install command, and compare against a version
  you already have.
- **Scan** a project for every dependency manifest and lock file, then report
  what is **outdated** with an upgrade type (major/minor/patch) and risk.
- **Reason** about versions: detect conflicting constraints, check whether a
  version satisfies a set of constraints, find the highest version that does,
  and build a step-by-step upgrade path through intermediate majors.
- **Optimize -> validate -> apply**: produce a whole-project upgrade plan,
  validate it for breaking changes and cycles, and write it to the manifests —
  **dry-run by default, with automatic timestamped backups** when it does write.

## Highlights

- **39 registries**, one consistent interface. See [Supported Registries](reference/registries.md).
- **15 tools**. See the [Tool Reference](reference/tools.md).
- **Local-first.** No API key required. An optional `GITHUB_TOKEN` only raises
  GitHub's rate limit for the `github`/`ghcr` registries.
- **Resilient.** Per-registry circuit breaker, request timeouts, response
  caching, and retries with backoff.
- **Safe writes.** The only tool that modifies files (`apply_upgrades`) defaults
  to a dry run and backs up every file it touches.

Start with [Getting Started](getting-started.md).
