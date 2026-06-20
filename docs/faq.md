# FAQ

### Does it need an API key?
No. Every registry works key-free. An optional `GITHUB_TOKEN` only raises GitHub
rate limits for the `github`/`ghcr` registries.

### Will `apply_upgrades` change my files without warning?
No. It defaults to `dry_run: true` (it computes and reports the diff but writes
nothing). You pass `dry_run: false` to write, and even then each file is backed
up to `.dependency-backups/` first and rolls back on error.

### Why a launcher script instead of `"command": "node"`?
Claude Code spawns MCP servers with a minimal PATH; `node`/`npm` often live in
nvm/volta/fnm/bun/homebrew dirs that are off that PATH, which makes a bare
command silently "Failed to connect". `scripts/mcp-server.sh` resolves Node
robustly, builds on first run, and execs the server.

### First launch is slow.
On first run the launcher installs dependencies and compiles TypeScript. That
happens once; later launches skip straight to the compiled server (it rebuilds
only when a source file is newer than the build).

### A registry call timed out.
Registry availability is external. The server has per-request timeouts, retries
with backoff, and a per-registry circuit breaker so one slow registry doesn't
stall everything. Tune `REGISTRY_TIMEOUT_MS` if needed.

### Which version am I running?
Versions are CalVer `YEAR.MONTH.BUILD`, auto-stamped from the repo's commit
count by the 88plug marketplace. `claude plugin list` shows the current value.

### Can I run it outside Claude Code?
Yes — it is a standard MCP server. Use `node build/index.js stdio` for stdio
clients or `node build/index.js http` for the Streamable HTTP transport. See
[Installation](installation.md).
