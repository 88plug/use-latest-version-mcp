# Configuration Examples

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

## Claude Code

Add to `.claude/mcp.json` in your project:

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

## Cline (VS Code Extension)

Add to your Cline MCP settings:

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

## Using npx (Alternative)

You can also publish to npm and use via npx:

```json
{
  "mcpServers": {
    "use-latest-version": {
      "type": "local",
      "command": ["npx", "-y", "use-latest-version-mcp-server"],
      "enabled": true
    }
  }
}
```

## Environment Variables (Optional)

For GitHub API rate limiting, you can add a GITHUB_TOKEN:

```json
{
  "mcpServers": {
    "use-latest-version": {
      "type": "local",
      "command": ["node", "/home/andrew/use-latest-version-mcp-server/build/index.js"],
      "enabled": true,
      "env": {
        "GITHUB_TOKEN": "your_github_token_here"
      }
    }
  }
}
```

## Testing the Configuration

After adding the configuration, restart your MCP client and test with:

1. List available tools: Should show `get_latest_version`, `get_package_info`, etc.
2. Test a tool: Try getting the latest version of a popular package
3. Check prompts: Should see `check-versions-reminder` and `verify-package-version`

## Example Usage in Chat

Once configured, you can ask:

- "What's the latest version of express on npm?"
- "Show me how to install the latest React"
- "Check if django 4.0.0 is the latest version"
- "Get info about the nginx docker image"

The MCP server will automatically query the registries and return current information, ensuring you never use outdated package versions.
