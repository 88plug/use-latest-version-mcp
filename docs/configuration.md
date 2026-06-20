# Configuration

Everything has a safe default; all configuration is via environment variables.

## Registry behavior

| Variable | Default | Purpose |
|---|---|---|
| `REGISTRY_TIMEOUT_MS` | `15000` | Per-request timeout for every registry HTTP call. |
| `REGISTRY_CACHE_TTL_MS` | `300000` | TTL for cached registry lookups. Set `0` to disable caching. |
| `GITHUB_TOKEN` | _(unset)_ | Optional. Raises GitHub API rate limits for the `github` and `ghcr` registries. Never required. |

The server also keeps a **per-registry circuit breaker** (a registry that is
actually down fails fast instead of timing out on every call) and **retries
with exponential backoff** on transient failures. A 4xx / not-found is treated
as a healthy response and does not trip the breaker.

## HTTP transport (`node build/index.js http`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `ALLOWED_ORIGINS` | _(open)_ | Comma-separated CORS allow-list. When unset, all origins are reflected; set it to lock the server down. |
| `MAX_SESSIONS` | `1000` | Cap on concurrent sessions, to bound memory. |
| `TRUST_PROXY` | _(unset)_ | Set (e.g. `1`) behind a reverse proxy so rate limiting keys on the real client IP. |

The HTTP server adds `helmet` security headers and rate limiting (100 requests
/ 15 min / IP) on `/mcp`, plus `/health` and `/ready` endpoints.

## `apply_upgrades` safety

The only tool that writes to disk defaults to **`dry_run: true`** and
**`create_backup: true`**. When it does write, each modified file is backed up
to `.dependency-backups/` first, and all edits for a file roll back
automatically if an error occurs. You opt in to writing explicitly with
`dry_run: false`.
