# Use Latest Version MCP Server

An MCP (Model Context Protocol) server that ensures you always use the latest versions of packages and libraries when working with large language models. This server provides real-time version information from multiple package registries, preventing outdated recommendations based on LLM training data.

## Features

- **Multiple Registry Support**: npm, PyPI, Maven Central, RubyGems, crates.io, Go modules, GitHub releases, DockerHub, and GitLab releases
- **Real-time Version Checking**: Always gets the current latest version from registries
- **Installation Commands**: Generates ready-to-use installation commands with the latest versions
- **Version Comparison**: Compare current versions with latest to identify updates
- **Batch Checking**: Check multiple packages at once
- **Version Compatibility**: Check if package versions are compatible with dependency constraints
- **Conflict Detection**: Detect version conflicts in dependency lists
- **Upgrade Path Recommendations**: Get step-by-step upgrade plans with risk assessment
- **Safe Version Suggestions**: Find compatible versions that satisfy all constraints

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

### 6. check_compatibility

Check if a package version is compatible with specified dependency constraints.

**Parameters:**
- `package_name` (string): The package name to check
- `version` (string): The version to check compatibility for
- `dependencies` (array): List of dependencies with their version constraints

**Example:**
```json
{
  "package_name": "react",
  "version": "18.2.0",
  "dependencies": [
    {"name": "react-dom", "constraint": "^18.0.0"},
    {"name": "typescript", "constraint": ">=4.0.0"}
  ]
}
```

### 7. detect_conflicts

Detect version conflicts in a list of dependencies.

**Parameters:**
- `dependencies` (array): List of dependencies to check for conflicts

**Example:**
```json
{
  "dependencies": [
    {"name": "lodash", "constraint": "^4.0.0", "source": "package-a"},
    {"name": "lodash", "constraint": "^3.0.0", "source": "package-b"}
  ]
}
```

### 8. suggest_upgrade_path

Generate a step-by-step upgrade path from current version to target version.

**Parameters:**
- `package_name` (string): The package name
- `registry` (string): The package registry
- `current_version` (string): Current version being used
- `target_version` (string, optional): Target version (defaults to latest)
- `dependencies` (array, optional): Dependencies that must remain compatible

**Example:**
```json
{
  "package_name": "react",
  "registry": "npm",
  "current_version": "16.0.0",
  "dependencies": [
    {"name": "react-dom", "constraint": "^16.0.0"}
  ]
}
```

### 9. find_compatible_version

Find the highest published version of a package that satisfies all specified
version constraints. For registries that can enumerate versions (npm, PyPI,
crates.io, NuGet, Go, RubyGems) every published version is checked; for others
only the latest version is checked and the response says so.

**Parameters:**
- `package_name` (string): The package name
- `registry` (string): The package registry
- `constraints` (array): List of version constraints to satisfy

**Example:**
```json
{
  "package_name": "express",
  "registry": "npm",
  "constraints": [
    {"name": "express", "constraint": "^4.17.0"}
  ]
}
```

### 10. scan_project

Scan a local project directory for dependency manifests (`package.json`,
`requirements.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`,
`pyproject.toml`) and lock files, returning every declared dependency with its
registry, version/constraint, and source file.

**Parameters:**
- `project_path` (string): Absolute path to the project directory
- `include_lock_files` (boolean, optional): Also parse lock files (default: true)
- `max_depth` (number, optional): Maximum directory recursion depth (default: 10)

**Example:**
```json
{ "project_path": "/path/to/project", "include_lock_files": true }
```

### 11. check_outdated

Scan a local project and check every dependency against its registry, reporting
which packages are outdated along with the latest version, upgrade type
(major/minor/patch), and estimated risk.

**Parameters:**
- `project_path` (string): Absolute path to the project directory
- `include_dev` (boolean, optional): Include development dependencies (default: true)
- `include_lock_files` (boolean, optional): Use lock-file versions when available (default: true)

**Example:**
```json
{ "project_path": "/path/to/project", "include_dev": true }
```

## How It Helps LLMs

When an LLM is building code, it may suggest outdated package versions based on its training data. This MCP server allows the LLM to:

1. **Query Current Versions**: Before suggesting a package installation, check the latest version
2. **Provide Accurate Commands**: Generate installation commands with current versions
3. **Identify Updates**: Compare versions in existing code with latest releases
4. **Stay Current**: Access real-time package information across multiple ecosystems
5. **Resolve Conflicts**: Detect and suggest solutions for version conflicts
6. **Plan Upgrades**: Get safe upgrade paths with risk assessment
7. **Ensure Compatibility**: Verify that package versions work together

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

## Environment Variables

All optional, with safe defaults.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP server port (`http` transport). |
| `HOST` | `0.0.0.0` | HTTP bind address. Set `127.0.0.1` for local-only. |
| `ALLOWED_ORIGINS` | _(unset = all)_ | Comma-separated CORS allow-list. When set, only these origins are permitted. |
| `MAX_SESSIONS` | `1000` | Maximum concurrent HTTP/MCP sessions before new ones are refused. |
| `TRUST_PROXY` | _(unset)_ | Set when running behind a reverse proxy so rate limiting keys on the real client IP (`1`, `true`, or a hop count). |
| `REGISTRY_TIMEOUT_MS` | `15000` | Per-request timeout for registry HTTP calls. |
| `REGISTRY_CACHE_TTL_MS` | `300000` | TTL for cached registry lookups. Set `0` to disable caching. |
| `GITHUB_TOKEN` | _(unset)_ | GitHub token for higher API rate limits. |

## Contributing

Contributions welcome! Please ensure:
- Code follows existing patterns
- New registries implement the `RegistryClient` interface
- Error handling is robust

## License

MIT
