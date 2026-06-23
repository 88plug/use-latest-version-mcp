#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
PY="${PYTHON:-python3}"

echo "=== smoke: manifest JSON valid ==="
"$PY" -c "import json; json.load(open('.claude-plugin/plugin.json')); print('  ok: .claude-plugin/plugin.json')"
"$PY" -c "import json; json.load(open('.claude-plugin/marketplace.json')); print('  ok: .claude-plugin/marketplace.json')"

echo "=== smoke: keywords == 20 ==="
"$PY" -c "
import json
d = json.load(open('.claude-plugin/plugin.json'))
n = len(d.get('keywords', []))
assert n == 20, f'keywords must be exactly 20, got {n}'
print(f'  ok: {n} keywords')
"

echo "=== smoke: mcp launcher referenced + present ==="
"$PY" -c "
import json
d = json.load(open('.claude-plugin/plugin.json'))
cmd = d['mcpServers']['use-latest-version']['command']
assert '\${CLAUDE_PLUGIN_ROOT}' in cmd, 'mcp command must use \${CLAUDE_PLUGIN_ROOT}'
print('  ok: launcher uses \${CLAUDE_PLUGIN_ROOT}')
"
test -f scripts/mcp-server.sh && echo "  ok: scripts/mcp-server.sh present"

echo "=== smoke: shell syntax ==="
for f in scripts/*.sh; do
    bash -n "$f" && echo "  ok: $f"
done

echo "=== smoke: all good ==="
