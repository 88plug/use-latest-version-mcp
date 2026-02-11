# Use Latest Version MCP Server

An MCP (Model Context Protocol) server that ensures you always use the latest versions of packages and libraries when working with large language models. This server provides real-time version information from multiple package registries, preventing outdated recommendations based on LLM training data.

## Features

- **Multiple Registry Support**: npm, PyPI, Maven Central, RubyGems, crates.io, Go modules, GitHub releases, DockerHub, and GitLab releases
- **Real-time Version Checking**: Always gets the current latest version from registries
- **Installation Commands**: Generates ready-to-use installation commands with the latest versions
- **Version Comparison**: Compare current versions with latest to identify updates
- **Batch Checking**: Check multiple packages at once

## Supported Registries

| Registry | Usage | Example Package Name |
|----------|-------|---------------------|
| npm | JavaScript/TypeScript packages | `express` |
| PyPI | Python packages | `requests` |
| Maven | Java packages | `org.springframework:spring-core` |
| crates.io | Rust packages | `serde` |
| RubyGems | Ruby packages | `rails` |
| Go | Go modules | `github.com/gin-gonic/gin` |
| GitHub | Repository releases | `facebook/react` |
| DockerHub | Container images | `nginx` or `library/nginx` |
| GitLab | GitLab releases | `gitlab-org/gitlab` |

## Quick Start

**Docker (Recommended for Public Access):**

```bash
# Run the server
docker run -p 3000:3000 cryptoandcoffee/mcp-server-use-latest-version:latest

# Configure your MCP client to connect to http://localhost:3000/mcp
```

For detailed Docker instructions, see [DOCKER-README.md](DOCKER-README.md).

**Local Installation:**

**Easy Installation:**

```bash
./install.sh
```

This will install the server and show you the configuration needed for your MCP client.

**Manual Installation:**

```bash
npm install
npm run build
```

For detailed installation instructions, see [INSTALL.md](INSTALL.md).

For a complete feature breakdown, see [FEATURES.md](FEATURES.md).

## Usage with Claude Code

Add to your Claude configuration file (`.claude/mcp.json` or `claude_desktop_config.json`):

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

## Active Interjection Features

This MCP server provides **proactive reminders** to LLMs during development:

### Prompts

1. **check-versions-reminder**: Automatically reminds the LLM to check versions before making recommendations
2. **verify-package-version**: Actively verifies and injects the latest version information for a specific package

### Resources

1. **version-policy://guidelines**: Version checking policy that the LLM can reference
2. **version-policy://registries**: Registry format reference guide

These features ensure the LLM actively checks versions rather than relying on potentially outdated training data.

## Available Tools

### 1. get_latest_version

Get the latest version of a package from a registry.

**Parameters:**
- `package_name` (string): The package name (format varies by registry)
- `registry` (string): One of: npm, pypi, maven, crates, rubygems, go, github, dockerhub, gitlab

**Example:**
```json
{
  "package_name": "express",
  "registry": "npm"
}
```

### 2. get_package_info

Get detailed information about a package including version, description, and metadata.

**Parameters:**
- `package_name` (string): The package name
- `registry` (string): The registry to query

**Example:**
```json
{
  "package_name": "requests",
  "registry": "pypi"
}
```

### 3. get_install_command

Get the command to install a package with its latest version.

**Parameters:**
- `package_name` (string): The package name
- `registry` (string): The registry
- `dev` (boolean, optional): For npm, install as dev dependency

**Example:**
```json
{
  "package_name": "react",
  "registry": "npm",
  "dev": false
}
```

### 4. compare_versions

Compare a current version with the latest available version.

**Parameters:**
- `package_name` (string): The package name
- `current_version` (string): The version currently in use
- `registry` (string): The registry

**Example:**
```json
{
  "package_name": "django",
  "current_version": "4.0.0",
  "registry": "pypi"
}
```

### 5. check_multiple_packages

Check latest versions of multiple packages at once.

**Parameters:**
- `packages` (array): Array of objects with `package_name` and `registry`

**Example:**
```json
{
  "packages": [
    {"package_name": "express", "registry": "npm"},
    {"package_name": "requests", "registry": "pypi"},
    {"package_name": "facebook/react", "registry": "github"}
  ]
}
```

## How It Helps LLMs

When an LLM is building code, it may suggest outdated package versions based on its training data. This MCP server allows the LLM to:

1. **Query Current Versions**: Before suggesting a package installation, check the latest version
2. **Provide Accurate Commands**: Generate installation commands with current versions
3. **Identify Updates**: Compare versions in existing code with latest releases
4. **Stay Current**: Access real-time package information across multiple ecosystems

## Example Workflow

1. User asks LLM: "Help me set up a React project"
2. LLM calls `get_latest_version` for "react" from npm registry
3. LLM receives current version (e.g., "18.3.1")
4. LLM calls `get_install_command` to get proper installation syntax
5. LLM provides user with: `npm install react@18.3.1`

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode for development
npm run watch

# Run directly
npm run dev
```

## API Rate Limits

Be aware of rate limits for public APIs:
- **GitHub**: 60 requests/hour (unauthenticated), 5000/hour (authenticated)
- **npm**: No strict limit, but be reasonable
- **PyPI**: No strict limit
- **DockerHub**: 100 pulls per 6 hours (unauthenticated)

For GitHub, you can set a `GITHUB_TOKEN` environment variable for higher rate limits.

## Contributing

Contributions welcome! Please ensure:
- Code follows existing patterns
- New registries implement the `RegistryClient` interface
- Error handling is robust

## License

MIT
