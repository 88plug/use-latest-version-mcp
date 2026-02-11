#!/bin/bash

set -e

echo "=========================================="
echo "Use Latest Version MCP Server Installer"
echo "=========================================="
echo ""

INSTALL_DIR="${HOME}/.mcp-servers/use-latest-version"
CONFIG_FILE=""

if [[ "$OSTYPE" == "darwin"* ]]; then
    CONFIG_FILE="${HOME}/Library/Application Support/Claude/claude_desktop_config.json"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    CONFIG_FILE="${APPDATA}/Claude/claude_desktop_config.json"
else
    CONFIG_FILE="${HOME}/.config/Claude/claude_desktop_config.json"
fi

echo "1. Creating installation directory..."
mkdir -p "$INSTALL_DIR"

echo "2. Copying files..."
cp -r package.json tsconfig.json src "$INSTALL_DIR/"

echo "3. Installing dependencies..."
cd "$INSTALL_DIR"
npm install

echo "4. Building..."
npm run build

echo ""
echo "✓ Installation complete!"
echo ""
echo "Installation location: $INSTALL_DIR"
echo ""
echo "=========================================="
echo "Next Steps:"
echo "=========================================="
echo ""
echo "Add this configuration to your MCP client:"
echo ""
echo "For Claude Desktop ($CONFIG_FILE):"
echo ""
cat <<EOF
{
  "mcpServers": {
    "use-latest-version": {
      "type": "local",
      "command": ["node", "$INSTALL_DIR/build/index.js"],
      "enabled": true
    }
  }
}
EOF
echo ""
echo "For Claude Code (.claude/mcp.json in your project):"
echo ""
cat <<EOF
{
  "mcpServers": {
    "use-latest-version": {
      "type": "local",
      "command": ["node", "$INSTALL_DIR/build/index.js"],
      "enabled": true
    }
  }
}
EOF
echo ""
echo "=========================================="
echo ""
