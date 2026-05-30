#!/usr/bin/env bash
#
# Real end-to-end integration test driven by an INDEPENDENT headless Claude
# instance acting as an MCP client. Unlike the node test-*.js suites (which are
# offline/deterministic), this exercises the built server over the real stdio
# MCP transport against live package registries — the "verify as an adversary"
# check, run from a fresh context that shares none of the implementation's
# assumptions.
#
# Requirements: the `claude` CLI (authenticated) and network access.
# Usage:        ./test-integration-claude.sh
# Cost:         spawns one headless claude -p session (~40 tool-calling turns).
#
set -euo pipefail
cd "$(dirname "$0")"

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found; skipping integration test"; exit 0; }

echo "==> Building server"
npm run build >/dev/null 2>&1

CONFIG="$(mktemp -d)/ulv-mcp.json"
cat > "$CONFIG" <<EOF
{"mcpServers":{"ulv":{"command":"node","args":["$(pwd)/build/index.js","stdio"]}}}
EOF

ITEST="$(mktemp -d)/proj"
mkdir -p "$ITEST"
cat > "$ITEST/package.json" <<'EOF'
{ "name": "itest", "version": "1.0.0", "dependencies": { "express": "4.17.0", "lodash": "4.17.20" } }
EOF

read -r -d '' PROMPT <<EOF || true
You are an independent integration tester for an MCP server named "ulv" that looks up
package versions across registries. Exercise its tools against REAL registries by actually
calling them, and report PASS/FAIL with any anomaly:
1. get_latest_version for {express,npm}, {requests,pypi}, {serde,crates}, {Newtonsoft.Json,nuget}.
   The nuget result MUST be a stable release (no '-beta'/'-rc' suffix).
2. get_package_info {react,npm} returns latestVersion + description.
3. compare_versions {express,npm} current "4.0.0" reports an update is available.
4. get_install_command {express,npm} must NOT contain a double space.
5. check_multiple_packages [{express,npm},{nonexistent-xyz123,npm}] — bogus one errors.
6. scan_project "$(pwd)" include_lock_files false — finds express and helmet.
7. check_outdated "$ITEST" — express and lodash reported outdated.
End with a fenced json array of {check,status,note} and an overall {summary,bugCount}.
EOF

echo "==> Running independent claude -p MCP client"
claude -p "$PROMPT" \
  --mcp-config "$CONFIG" \
  --allowedTools "mcp__ulv__get_latest_version,mcp__ulv__get_package_info,mcp__ulv__get_install_command,mcp__ulv__compare_versions,mcp__ulv__check_multiple_packages,mcp__ulv__scan_project,mcp__ulv__check_outdated" \
  --output-format json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).result)}catch{console.log(d)}})"
