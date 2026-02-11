# Installation Guide

## Quick Install (Recommended)

### Method 1: Using the install script

```bash
./install.sh
```

This will:
1. Copy files to `~/.mcp-servers/use-latest-version`
2. Install dependencies
3. Build the project
4. Display configuration instructions

### Method 2: Manual Installation

```bash
# Clone or navigate to the project directory
cd use-latest-version-mcp-server

# Install dependencies
npm install

# Build the project
npm run build

# Note the absolute path
pwd
```

Then add to your MCP client configuration (see Configuration section below).

### Method 3: Global npm install (Coming Soon)

Once published to npm:

```bash
npm install -g use-latest-version-mcp-server
```

Then use in your config:

```json
{
  "mcpServers": {
    "use-latest-version": {
      "command": "use-latest-version-mcp-server"
    }
  }
}
```

## Configuration

### Claude Desktop

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "use-latest-version": {
      "type": "local",
      "command": ["node", "/home/andrew/use-latest-version-mcp-server/build/index.js"],
      "enabled": true
    }
  }
}
```

### Claude Code

Create or edit `.claude/mcp.json` in your project:

```json
{
  "mcpServers": {
    "use-latest-version": {
      "type": "local",
      "command": ["node", "/home/andrew/use-latest-version-mcp-server/build/index.js"],
      "enabled": true
    }
  }
}
```

### Other MCP Clients

Most MCP clients use a similar configuration format. Replace the path with your actual installation path.

## Verify Installation

After configuration:

1. Restart your MCP client
2. Try asking: "What's the latest version of express on npm?"
3. The MCP server should query the npm registry and return the current version

## Testing

Run the test script to verify all registries are working:

```bash
node test-registries.js
```

You should see output like:

```
Testing npm: express
  ✓ Latest version: 5.2.1
  ✓ Description: Fast, unopinionated, minimalist web framework...

Testing pypi: requests
  ✓ Latest version: 2.32.5
  ✓ Description: Python HTTP for Humans....

...

✓ All tests passed! MCP server is ready to use.
```

## Updating

To update to the latest version:

```bash
cd /path/to/use-latest-version-mcp-server
git pull  # if installed from git
npm install
npm run build
```

## Uninstalling

```bash
# Remove installation directory
rm -rf ~/.mcp-servers/use-latest-version

# Remove configuration from your MCP client config file
# (Manually edit the JSON file to remove the "use-latest-version" entry)
```

## Troubleshooting

### Server not starting

- Check that Node.js is installed: `node --version` (requires v18+)
- Verify the path in your configuration is absolute and correct
- Check for errors in your MCP client's log files

### Registry queries failing

- Test your network connection
- Some registries may have rate limits
- For GitHub, consider adding a GITHUB_TOKEN environment variable

### Permission errors

- Ensure the build directory has proper permissions
- Run `npm run build` to rebuild if needed

## Support

For issues, please check:
- Network connectivity
- Node.js version compatibility
- MCP client documentation
- Registry API status pages
