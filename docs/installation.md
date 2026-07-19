# Installation

## Requirements

- **Node.js >= 18** (the server is built and run with Node; the plugin launcher
  resolves `node` from your PATH or common version-manager locations)
- Outbound HTTPS to the registries you query

## Claude Code plugin (recommended)

```sh
/plugin marketplace add 88plug/claude-code-plugins
/plugin install use-latest-version@88plug
```

### Grok Build

```text
grok plugin marketplace add 88plug/claude-code-plugins
grok plugin install use-latest-version@88plug --trust
```

Enable auto-update once (`/plugin` → Marketplaces → **88plug** → Enable
auto-update) and you always get the latest at startup.

The plugin ships source only. On first launch, `scripts/mcp-server.sh`:

1. resolves a Node >= 18 binary (PATH, then nvm / volta / fnm / bun / homebrew)
2. installs dependencies and compiles TypeScript (`npm ci && npm run build`)
3. execs `node build/index.js stdio`

All build output goes to stderr, so the stdio MCP channel stays clean. Later
launches skip the build unless a source file is newer than the compiled output.

## Manual / standalone

Clone and run either transport directly:

```sh
git clone https://github.com/88plug/use-latest-version-mcp
cd use-latest-version-mcp
npm install
npm run build

# stdio (for MCP clients)
node build/index.js stdio

# or HTTP (Streamable HTTP transport)
node build/index.js http     # listens on $PORT (default 3000)
```

### Register with any MCP client

Point your client's MCP config at the launcher (stdio):

```json
{
  "mcpServers": {
    "use-latest-version": {
      "command": "bash",
      "args": ["/absolute/path/to/use-latest-version-mcp/scripts/mcp-server.sh"]
    }
  }
}
```

Or at the built server if Node is already on PATH:

```json
{
  "mcpServers": {
    "use-latest-version": {
      "command": "node",
      "args": ["/absolute/path/to/use-latest-version-mcp/build/index.js", "stdio"]
    }
  }
}
```

Prefer the launcher when the client spawns with a minimal PATH (common with
Claude Code). See [FAQ](faq.md).

## Docker (HTTP transport)

```sh
docker build -t use-latest-version-mcp .
docker run --rm -p 3000:3000 use-latest-version-mcp
curl localhost:3000/health
```

HTTP env vars (`PORT`, `HOST`, `ALLOWED_ORIGINS`, …): [Configuration](configuration.md).

## Next steps

- [Getting Started](getting-started.md) — first tool calls and the upgrade pipeline
- [Tool Reference](reference/tools.md) — all 15 tools
- [Supported Registries](reference/registries.md) — package name formats
