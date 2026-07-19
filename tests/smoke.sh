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
cfg = d['mcpServers']['use-latest-version']
cmd = cfg.get('command', '')
args = cfg.get('args') or []
blob = ' '.join([cmd] + list(args))
assert '\${CLAUDE_PLUGIN_ROOT}' in blob, 'mcp must use \${CLAUDE_PLUGIN_ROOT}'
assert 'mcp-server.sh' in blob, 'mcp must launch scripts/mcp-server.sh'
fragile = {'python', 'python3', 'node', 'npx', 'uv', 'uvx'}
assert cmd not in fragile, f'bare command {cmd!r} is PATH-fragile'
print('  ok: launcher uses \${CLAUDE_PLUGIN_ROOT} via', cmd)
"
test -f scripts/mcp-server.sh && echo "  ok: scripts/mcp-server.sh present"
test -x scripts/mcp-server.sh && echo "  ok: scripts/mcp-server.sh executable"

echo "=== smoke: required keywords ==="
"$PY" -c "
import json
k = set(json.load(open('.claude-plugin/plugin.json')).get('keywords', []))
for req in ('claude-code-plugin', 'claude-skills', 'mcp', 'mcp-server', 'model-context-protocol'):
    assert req in k, f'missing keyword {req}'
print('  ok: required keywords present')
"

echo "=== smoke: hub install name in README ==="
grep -q 'use-latest-version@88plug' README.md && echo "  ok: use-latest-version@88plug in README"
grep -qE 'grok plugin install use-latest-version@88plug' README.md && echo "  ok: Grok dual install in README"
! grep -q 'use-latest-version-mcp@88plug' README.md && echo "  ok: no wrong -mcp@88plug install name"

echo "=== smoke: shell syntax ==="
for f in scripts/*.sh; do
    bash -n "$f" && echo "  ok: $f"
done

echo "=== smoke: all good ==="
