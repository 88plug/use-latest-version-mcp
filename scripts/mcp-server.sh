#!/usr/bin/env bash
# mcp-server.sh — launch the use-latest-version MCP server over stdio.
#
# WHY a launcher instead of "command": "node" in plugin.json:
# Claude Code spawns MCP servers with a minimal PATH. node/npm frequently live
# under nvm / volta / fnm / bun / homebrew directories that are NOT on that PATH,
# so a bare "node" command silently "Failed to connect". This script resolves a
# Node (>=18) binary robustly, builds the TypeScript on first run (the repo ships
# source only — build/ is gitignored), and then execs the compiled server.
#
# IMPORTANT: stdout is the MCP stdio transport. All build/diagnostic output is
# sent to stderr so it never corrupts the protocol stream.
set -euo pipefail

if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  ROOT="$CLAUDE_PLUGIN_ROOT"
else
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
fi
cd "$ROOT"

# Resolve a node binary: PATH first, then common version-manager locations.
_resolve_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  local c
  for c in \
    "${USE_LATEST_VERSION_NODE:-}" \
    /usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node \
    "$HOME/.bun/bin/node" "$HOME/.volta/bin/node" \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node; do
    if [ -n "$c" ] && [ -x "$c" ]; then printf '%s' "$c"; return 0; fi
  done
  return 1
}

NODE="$(_resolve_node || true)"
if [ -z "${NODE:-}" ]; then
  echo "use-latest-version-mcp: could not find a Node.js (>=18) binary." >&2
  echo "Install Node.js, or set USE_LATEST_VERSION_NODE to its absolute path." >&2
  exit 1
fi
NODE_BIN_DIR="$(dirname "$NODE")"
export PATH="$NODE_BIN_DIR:$PATH"
NPM="$NODE_BIN_DIR/npm"
[ -x "$NPM" ] || NPM="npm"

# Build on first run, or when a source file is newer than the compiled output.
needs_build=0
if [ ! -f build/index.js ]; then
  needs_build=1
elif [ -n "$(find src -name '*.ts' -newer build/index.js 2>/dev/null | head -n1)" ]; then
  needs_build=1
fi

if [ "$needs_build" = "1" ]; then
  {
    echo "use-latest-version-mcp: building (first run / sources changed)..."
    if [ -f package-lock.json ]; then
      "$NPM" ci --no-audit --no-fund || "$NPM" install --no-audit --no-fund
    else
      "$NPM" install --no-audit --no-fund
    fi
    "$NPM" run build
  } 1>&2   # keep stdout clean for the MCP transport
fi

exec "$NODE" build/index.js stdio
