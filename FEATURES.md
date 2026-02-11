# Feature Matrix

## Registry Support

| Registry | Get Version | Package Info | Install Command | Description | Homepage | Published Date | Status |
|----------|-------------|--------------|-----------------|-------------|----------|----------------|--------|
| **npm** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 Production |
| **PyPI** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟢 Production |
| **Maven** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | 🟢 Production |
| **crates.io** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟢 Production |
| **RubyGems** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟢 Production |
| **Go Modules** | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | 🟢 Production |
| **GitHub** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 Production |
| **DockerHub** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | 🟢 Production |
| **GitLab** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 Production |

## MCP Capabilities

| Capability | Supported | Description |
|------------|-----------|-------------|
| **Tools** | ✅ | 5 tools for querying package versions |
| **Prompts** | ✅ | 2 prompts for active interjection |
| **Resources** | ✅ | 2 resources with policy documentation |
| **Sampling** | ❌ | Not applicable for this server |
| **Roots** | ❌ | Not applicable for this server |

## Tools Feature Matrix

| Tool | Single Package | Multiple Packages | Version Comparison | Install Commands | Async Support |
|------|----------------|-------------------|-------------------|------------------|---------------|
| **get_latest_version** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **get_package_info** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **get_install_command** | ✅ | ❌ | ❌ | ✅ | ✅ |
| **compare_versions** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **check_multiple_packages** | ❌ | ✅ | ❌ | ❌ | ✅ |

## Package Name Format Support

| Registry | Format | Example | Namespace Support | Version Pinning |
|----------|--------|---------|-------------------|-----------------|
| **npm** | `package-name` | `express` | ✅ (`@org/package`) | ✅ |
| **PyPI** | `package-name` | `requests` | ❌ | ✅ |
| **Maven** | `groupId:artifactId` | `org.springframework:spring-core` | ✅ | ✅ |
| **crates.io** | `package-name` | `serde` | ❌ | ✅ |
| **RubyGems** | `package-name` | `rails` | ❌ | ✅ |
| **Go** | `module-path` | `github.com/gin-gonic/gin` | ✅ | ✅ |
| **GitHub** | `owner/repo` | `facebook/react` | ✅ | ✅ |
| **DockerHub** | `[namespace/]image` | `nginx` or `mysql/mysql-server` | ✅ | ✅ |
| **GitLab** | `namespace/project` | `gitlab-org/gitlab` | ✅ | ✅ |

## Installation Command Generation

| Registry | Command Type | Dev Dependencies | Version Pinning | Additional Options |
|----------|--------------|------------------|-----------------|-------------------|
| **npm** | `npm install` | ✅ | ✅ | ✅ (--save-dev) |
| **PyPI** | `pip install` | ❌ | ✅ | ❌ |
| **Maven** | XML snippet | ❌ | ✅ | ✅ (scope) |
| **crates.io** | `cargo add` | ❌ | ✅ | ❌ |
| **RubyGems** | `gem install` | ❌ | ✅ | ❌ |
| **Go** | `go get` | ❌ | ✅ | ❌ |
| **GitHub** | `git clone` + `wget` | N/A | ✅ | ✅ (release download) |
| **DockerHub** | `docker pull` | N/A | ✅ | ❌ |
| **GitLab** | `git clone` + `wget` | N/A | ✅ | ✅ (release download) |

## Active Interjection Features

| Feature | Type | Auto-Triggered | User-Invokable | Parameters |
|---------|------|----------------|----------------|------------|
| **check-versions-reminder** | Prompt | ❌ | ✅ | None |
| **verify-package-version** | Prompt | ❌ | ✅ | package_name, registry |
| **version-policy://guidelines** | Resource | ❌ | ✅ | None |
| **version-policy://registries** | Resource | ❌ | ✅ | None |

## API Rate Limits & Authentication

| Registry | Rate Limit | Authentication | Required | Environment Variable |
|----------|------------|----------------|----------|---------------------|
| **npm** | None (fair use) | ❌ | ❌ | N/A |
| **PyPI** | None (fair use) | ❌ | ❌ | N/A |
| **Maven** | None | ❌ | ❌ | N/A |
| **crates.io** | None (fair use) | ❌ | ❌ | N/A |
| **RubyGems** | None (fair use) | ❌ | ❌ | N/A |
| **Go** | None | ❌ | ❌ | N/A |
| **GitHub** | 60/hour (unauth), 5000/hour (auth) | ✅ | ❌ | `GITHUB_TOKEN` |
| **DockerHub** | 100 pulls/6h (unauth) | ✅ | ❌ | `DOCKER_TOKEN` |
| **GitLab** | 300/hour (unauth) | ✅ | ❌ | `GITLAB_TOKEN` |

## Error Handling

| Error Type | Handled | Fallback | User Message |
|------------|---------|----------|--------------|
| **Package Not Found** | ✅ | ❌ | Clear error message |
| **Network Error** | ✅ | ❌ | Network connectivity message |
| **Invalid Format** | ✅ | ❌ | Format requirement message |
| **Rate Limit** | ✅ | ❌ | Rate limit + suggestion |
| **Timeout** | ✅ | ❌ | Timeout error |
| **Invalid Registry** | ✅ | ❌ | Supported registries list |

## Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| **Startup Time** | < 100ms | Node.js + MCP SDK |
| **Single Query** | 200-1000ms | Depends on registry API |
| **Batch Query** | Parallel | All queries run concurrently |
| **Memory Usage** | < 50MB | Lightweight, no caching |
| **Concurrent Requests** | Unlimited | No internal queuing |
| **Cache** | ❌ | Always fetches latest data |

## Version Detection Intelligence

| Feature | Supported | Description |
|---------|-----------|-------------|
| **Semantic Versioning** | ✅ | Understands semver format |
| **Tag Prefixes** | ✅ | Handles `v1.0.0` and `1.0.0` |
| **Pre-release Versions** | ✅ | Detects alpha/beta/rc |
| **Latest Tag** | ✅ | Identifies "latest" on DockerHub |
| **Date-based Versions** | ✅ | Supports YYYYMMDD format |
| **Commit SHAs** | ❌ | Not supported |

## Platform Support

| Platform | Supported | Tested | Notes |
|----------|-----------|--------|-------|
| **Linux** | ✅ | ✅ | Primary development platform |
| **macOS** | ✅ | ⚠️ | Should work (standard Node.js) |
| **Windows** | ✅ | ⚠️ | Should work (standard Node.js) |
| **Docker** | ✅ | ❌ | Can be containerized |
| **WSL** | ✅ | ⚠️ | Should work (Linux env) |

## Integration Matrix

| Client | Compatible | Tested | Configuration Format |
|--------|------------|--------|---------------------|
| **Claude Desktop** | ✅ | ❌ | JSON with type/command/enabled |
| **Claude Code** | ✅ | ✅ | JSON with type/command/enabled |
| **Cline (VS Code)** | ✅ | ❌ | JSON with type/command/enabled |
| **MCP Inspector** | ✅ | ❌ | Standard MCP |
| **Custom Clients** | ✅ | ❌ | Any MCP-compatible client |

## Comparison with Alternatives

| Feature | This MCP Server | LLM Training Data | Manual Search | GitHub Dependabot |
|---------|----------------|-------------------|---------------|-------------------|
| **Real-time Data** | ✅ | ❌ | ✅ | ✅ |
| **Multiple Registries** | ✅ (9) | ✅ | ✅ | ⚠️ (limited) |
| **Automated** | ✅ | ✅ | ❌ | ✅ |
| **Active Interjection** | ✅ | ❌ | ❌ | ❌ |
| **No Setup Per Project** | ✅ | ✅ | ✅ | ❌ |
| **Install Commands** | ✅ | ✅ | ❌ | ⚠️ |
| **Works Offline** | ❌ | ✅ | ❌ | ❌ |
| **Historical Versions** | ❌ | ✅ | ✅ | ✅ |

## Future Roadmap

| Feature | Status | Priority | Complexity |
|---------|--------|----------|------------|
| **Homebrew Support** | 📋 Planned | Medium | Medium |
| **NuGet (.NET)** | 📋 Planned | Medium | Low |
| **Packagist (PHP)** | 📋 Planned | Medium | Low |
| **CPAN (Perl)** | 📋 Planned | Low | Low |
| **Hex (Elixir)** | 📋 Planned | Low | Low |
| **CRAN (R)** | 📋 Planned | Low | Medium |
| **Version History** | 💡 Idea | Low | Medium |
| **Vulnerability Check** | 💡 Idea | High | High |
| **Caching Layer** | 💡 Idea | Low | Medium |
| **Batch CSV Export** | 💡 Idea | Low | Low |
| **Auto-Update Detection** | 💡 Idea | Medium | High |
| **License Information** | 💡 Idea | Medium | Medium |
| **Download Stats** | 💡 Idea | Low | Low |
| **Breaking Changes Alert** | 💡 Idea | High | High |

## Legend

- ✅ Fully Supported
- ⚠️ Partially Supported / Untested
- ❌ Not Supported
- 🟢 Production Ready
- 🟡 Beta
- 🔴 Experimental
- 📋 Planned
- 💡 Under Consideration
- N/A Not Applicable
