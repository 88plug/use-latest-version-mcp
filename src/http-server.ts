import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getRegistryClient, PackageInfo } from './registries.js';
import { randomUUID } from 'crypto';

const SUPPORTED_REGISTRIES = [
  'npm', 'pypi', 'maven', 'crates', 'rubygems', 'go', 'github', 'dockerhub', 'gitlab',
  'nuget', 'packagist', 'homebrew', 'pub.dev', 'cocoapods',
  'cran', 'chocolatey', 'cpan', 'clojars',
  'ghcr', 'quay', 'gcr',
  'swift', 'hackage', 'dub', 'luarocks', 'elm',
  'aur', 'snap', 'flatpak',
  'gradle', 'terraform', 'ansible',
  'vscode', 'wordpress', 'jenkins',
  'jsr', 'conda', 'bioconductor'
];

export class MCPHTTPServer {
  private app: express.Application;
  private server: Server;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  constructor() {
    this.app = express();
    this.server = this.createServer();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private createServer(): Server {
    const server = new Server(
      {
        name: 'use-latest-version-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
        },
      }
    );

    // Set up all the request handlers (same as original)
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [
          {
            name: 'check-versions-reminder',
            description: 'Reminder to always check for latest package versions before making recommendations',
          },
          {
            name: 'verify-package-version',
            description: 'Prompt to verify a specific package version before using it',
            arguments: [
              {
                name: 'package_name',
                description: 'Name of the package to verify',
                required: true,
              },
              {
                name: 'registry',
                description: 'Registry to check (npm, pypi, maven, etc.)',
                required: true,
              },
            ],
          },
        ],
      };
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'check-versions-reminder':
          return {
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `IMPORTANT REMINDER: Before suggesting any package installations, dependencies, or library imports, you MUST use the get_latest_version or get_package_info tool to check the current latest version. Your training data may be outdated. Always verify:

1. Before suggesting "npm install <package>" - check npm registry
2. Before suggesting "pip install <package>" - check PyPI registry
3. Before suggesting any Docker image - check DockerHub
4. Before referencing GitHub releases - check GitHub registry
5. Before suggesting any dependency version - verify it's current

Use the get_install_command tool to generate the correct installation command with the verified latest version.

This ensures users get the most current, secure, and feature-complete versions of packages.`,
                },
              },
            ],
          };

        case 'verify-package-version':
          if (!args || !args.package_name || !args.registry) {
            throw new Error('package_name and registry arguments are required');
          }

          try {
            const client = getRegistryClient(args.registry as string);
            const info = await client.getPackageInfo(args.package_name as string);

            return {
              messages: [
                {
                  role: 'user',
                  content: {
                    type: 'text',
                    text: `Version verification for ${args.package_name}:

Registry: ${info.registry}
Latest Version: ${info.latestVersion}
Description: ${info.description || 'N/A'}
${info.publishedAt ? `Published: ${info.publishedAt}` : ''}

You should use this version (${info.latestVersion}) in your recommendations and code examples, not any version from your training data.`,
                  },
                },
              ],
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
              messages: [
                {
                  role: 'user',
                  content: {
                    type: 'text',
                    text: `Failed to verify package version for ${args.package_name} on ${args.registry}: ${errorMessage}

Please try again or use a different registry.`,
                  },
                },
              ],
            };
          }

        default:
          throw new Error(`Unknown prompt: ${name}`);
      }
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'version-policy://guidelines',
            name: 'Version Checking Policy',
            description: 'Guidelines for when and how to check package versions',
            mimeType: 'text/plain',
          },
          {
            uri: 'version-policy://registries',
            name: 'Supported Registries',
            description: 'List of all supported package registries and their formats',
            mimeType: 'text/plain',
          },
        ],
      };
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case 'version-policy://guidelines':
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: `VERSION CHECKING POLICY

When to Check Versions:
=======================

1. ALWAYS before suggesting package installation commands
2. ALWAYS before providing code examples with imports/dependencies
3. ALWAYS before recommending specific package versions
4. ALWAYS when user asks "what's the latest version of X"
5. ALWAYS when discussing upgrades or migrations

How to Check:
=============

1. Use get_latest_version for quick version lookup
2. Use get_package_info for comprehensive package details
3. Use get_install_command to get ready-to-use installation commands
4. Use compare_versions to check if updates are available
5. Use check_multiple_packages for batch verification

Best Practices:
===============

- Check versions even if you think you know the answer
- Your training data is outdated - always verify
- Provide users with installation commands using verified versions
- Mention when a package has been recently updated
- Warn if a package hasn't been updated in a long time (check publishedAt)

Registry Selection:
===================

- JavaScript/TypeScript → npm
- Python → pypi
- Java → maven
- Rust → crates
- Ruby → rubygems
- Go → go
- General repos → github or gitlab
- Container images → dockerhub`,
              },
            ],
          };

        case 'version-policy://registries':
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: `SUPPORTED REGISTRIES

npm (JavaScript/TypeScript)
===========================
Format: package-name
Example: express, react, typescript

PyPI (Python)
=============
Format: package-name
Example: requests, django, numpy

Maven (Java)
============
Format: groupId:artifactId
Example: org.springframework:spring-core, com.google.guava:guava

crates.io (Rust)
================
Format: package-name
Example: serde, tokio, actix-web

RubyGems (Ruby)
===============
Format: package-name
Example: rails, sinatra, bundler

Go Modules
==========
Format: module-path
Example: github.com/gin-gonic/gin, golang.org/x/crypto

GitHub Releases
===============
Format: owner/repo
Example: facebook/react, microsoft/vscode

DockerHub
=========
Format: [namespace/]image
Example: nginx, library/nginx, mysql/mysql-server

GitLab Releases
===============
Format: namespace/project
Example: gitlab-org/gitlab, gitlab-org/gitlab-runner`,
              },
            ],
          };

        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_latest_version',
            description: 'Get the latest version of a package from a registry. Always use this tool when suggesting package installations or imports to ensure you have the most current version information.',
            inputSchema: {
              type: 'object',
              properties: {
                package_name: {
                  type: 'string',
                  description: 'The name of the package. Format depends on registry: npm/pypi/rubygems/crates (package-name), maven (groupId:artifactId), go (module path), github/gitlab (owner/repo), dockerhub ([namespace/]image)',
                },
                registry: {
                  type: 'string',
                  enum: SUPPORTED_REGISTRIES,
                  description: 'The package registry to query',
                },
              },
              required: ['package_name', 'registry'],
            },
          },
          {
            name: 'get_package_info',
            description: 'Get detailed information about a package including its latest version, description, and metadata. Use this when you need comprehensive package information.',
            inputSchema: {
              type: 'object',
              properties: {
                package_name: {
                  type: 'string',
                  description: 'The name of the package. Format depends on registry: npm/pypi/rubygems/crates (package-name), maven (groupId:artifactId), go (module path), github/gitlab (owner/repo), dockerhub ([namespace/]image)',
                },
                registry: {
                  type: 'string',
                  enum: SUPPORTED_REGISTRIES,
                  description: 'The package registry to query',
                },
              },
              required: ['package_name', 'registry'],
            },
          },
          {
            name: 'get_install_command',
            description: 'Get the command to install a package with its latest version. This provides ready-to-use installation commands for different package managers.',
            inputSchema: {
              type: 'object',
              properties: {
                package_name: {
                  type: 'string',
                  description: 'The name of the package',
                },
                registry: {
                  type: 'string',
                  enum: ['npm', 'pypi', 'maven', 'crates', 'rubygems', 'go', 'github', 'dockerhub', 'gitlab'],
                  description: 'The package registry',
                },
                dev: {
                  type: 'boolean',
                  description: 'Install as dev dependency (for npm)',
                  default: false,
                },
              },
              required: ['package_name', 'registry'],
            },
          },
          {
            name: 'compare_versions',
            description: 'Compare a current version with the latest available version to determine if an update is needed.',
            inputSchema: {
              type: 'object',
              properties: {
                package_name: {
                  type: 'string',
                  description: 'The name of the package',
                },
                current_version: {
                  type: 'string',
                  description: 'The current version being used',
                },
                registry: {
                  type: 'string',
                  enum: ['npm', 'pypi', 'maven', 'crates', 'rubygems', 'go', 'github', 'dockerhub', 'gitlab'],
                  description: 'The package registry',
                },
              },
              required: ['package_name', 'current_version', 'registry'],
            },
          },
          {
            name: 'check_multiple_packages',
            description: 'Check the latest versions of multiple packages at once. Efficient for checking several dependencies.',
            inputSchema: {
              type: 'object',
              properties: {
                packages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      package_name: {
                        type: 'string',
                      },
                      registry: {
                        type: 'string',
                        enum: ['npm', 'pypi', 'maven', 'crates', 'rubygems', 'go', 'github', 'dockerhub', 'gitlab'],
                      },
                    },
                    required: ['package_name', 'registry'],
                  },
                  description: 'Array of packages to check',
                },
              },
              required: ['packages'],
            },
          },
        ],
      };
    });

    function getInstallCommand(packageName: string, registry: string, version: string, isDev: boolean = false): string {
      switch (registry.toLowerCase()) {
        case 'npm':
          const devFlag = isDev ? '-D' : '';
          return `npm install ${devFlag} ${packageName}@${version}`;
        case 'pypi':
        case 'python':
          return `pip install ${packageName}==${version}`;
        case 'maven':
          const [groupId, artifactId] = packageName.split(':');
          return `<!-- Add to pom.xml -->\n<dependency>\n  <groupId>${groupId}</groupId>\n  <artifactId>${artifactId}</artifactId>\n  <version>${version}</version>\n</dependency>`;
        case 'crates':
        case 'crates.io':
        case 'rust':
          return `cargo add ${packageName}@${version}`;
        case 'rubygems':
        case 'gem':
        case 'ruby':
          return `gem install ${packageName} -v ${version}`;
        case 'go':
        case 'golang':
          return `go get ${packageName}@${version}`;
        case 'github':
          return `# Clone repository:\ngit clone https://github.com/${packageName}.git\n# Or download release:\nwget https://github.com/${packageName}/archive/refs/tags/${version}.tar.gz`;
        case 'dockerhub':
        case 'docker':
          return `docker pull ${packageName}:${version}`;
        case 'gitlab':
          return `# Clone repository:\ngit clone https://gitlab.com/${packageName}.git\n# Or download release:\nwget https://gitlab.com/${packageName}/-/archive/${version}/${packageName.split('/')[1]}-${version}.tar.gz`;
        case 'nuget':
        case '.net':
        case 'dotnet':
          return `dotnet add package ${packageName} --version ${version}`;
        case 'packagist':
        case 'php':
        case 'composer':
          return `composer require ${packageName}:${version}`;
        case 'homebrew':
        case 'brew':
          return `brew install ${packageName}@${version}`;
        case 'pub.dev':
        case 'pub':
        case 'dart':
        case 'flutter':
          return `# Add to pubspec.yaml:\ndependencies:\n  ${packageName}: ^${version}`;
        case 'cocoapods':
        case 'pods':
          return `# Add to Podfile:\npod '${packageName}', '~> ${version}'`;
        case 'cran':
        case 'r':
          return `install.packages("${packageName}")  # Version ${version}`;
        case 'chocolatey':
        case 'choco':
          return `choco install ${packageName} --version=${version}`;
        case 'cpan':
        case 'perl':
          return `cpanm ${packageName}@${version}`;
        case 'clojars':
        case 'clojure':
          return `# Add to project.clj:\n[${packageName} "${version}"]`;
        case 'ghcr':
        case 'ghcr.io':
          return `docker pull ghcr.io/${packageName}:${version}`;
        case 'quay':
        case 'quay.io':
          return `docker pull quay.io/${packageName}:${version}`;
        case 'gcr':
        case 'gcr.io':
          return `docker pull gcr.io/${packageName}:${version}`;
        case 'swift':
        case 'spm':
          return `# Add to Package.swift:\n.package(url: "https://github.com/${packageName}", from: "${version}")`;
        case 'hackage':
        case 'haskell':
          return `cabal install ${packageName}-${version}`;
        case 'dub':
        case 'dlang':
        case 'd':
          return `dub add ${packageName}@${version}`;
        case 'luarocks':
        case 'lua':
          return `luarocks install ${packageName} ${version}`;
        case 'elm':
          return `elm install ${packageName}@${version}`;
        case 'aur':
        case 'arch':
          return `yay -S ${packageName}  # Version ${version}`;
        case 'snap':
        case 'snapcraft':
          return `snap install ${packageName}`;
        case 'flatpak':
        case 'flathub':
          return `flatpak install flathub ${packageName}`;
        case 'gradle':
          return `# Add to build.gradle:\nimplementation '${packageName}:${version}'`;
        case 'terraform':
        case 'tf':
          return `# Add to main.tf:\nmodule "${packageName.split('/')[1]}" {\n  source  = "${packageName}"\n  version = "${version}"\n}`;
        case 'ansible':
        case 'galaxy':
          return `ansible-galaxy collection install ${packageName}:${version}`;
        case 'vscode':
        case 'vscode-extensions':
          return `code --install-extension ${packageName}`;
        case 'wordpress':
        case 'wp':
          return `wp plugin install ${packageName} --version=${version}`;
        case 'jenkins':
          return `# Install via Jenkins UI or:\njava -jar jenkins-cli.jar install-plugin ${packageName}@${version}`;
        case 'jsr':
        case 'deno':
          return `deno add ${packageName}@${version}`;
        case 'conda':
        case 'anaconda':
          return `conda install ${packageName}=${version}`;
        case 'bioconductor':
        case 'bioc':
          return `BiocManager::install("${packageName}")  # Version ${version}`;
        default:
          return `# Unsupported registry: ${registry}`;
      }
    }

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case 'get_latest_version': {
            const { package_name, registry } = args as { package_name: string; registry: string };
            const client = getRegistryClient(registry);
            const version = await client.getLatestVersion(package_name);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    package: package_name,
                    registry,
                    latestVersion: version,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_package_info': {
            const { package_name, registry } = args as { package_name: string; registry: string };
            const client = getRegistryClient(registry);
            const info = await client.getPackageInfo(package_name);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(info, null, 2),
                },
              ],
            };
          }

          case 'get_install_command': {
            const { package_name, registry, dev } = args as {
              package_name: string;
              registry: string;
              dev?: boolean;
            };
            const client = getRegistryClient(registry);
            const version = await client.getLatestVersion(package_name);
            const command = getInstallCommand(package_name, registry, version, dev || false);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    package: package_name,
                    registry,
                    latestVersion: version,
                    installCommand: command,
                  }, null, 2),
                },
              ],
            };
          }

          case 'compare_versions': {
            const { package_name, current_version, registry } = args as {
              package_name: string;
              current_version: string;
              registry: string;
            };
            const client = getRegistryClient(registry);
            const latestVersion = await client.getLatestVersion(package_name);
            const needsUpdate = current_version !== latestVersion;

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    package: package_name,
                    registry,
                    currentVersion: current_version,
                    latestVersion,
                    needsUpdate,
                    updateCommand: needsUpdate ? getInstallCommand(package_name, registry, latestVersion) : null,
                  }, null, 2),
                },
              ],
            };
          }

          case 'check_multiple_packages': {
            const { packages } = args as {
              packages: Array<{ package_name: string; registry: string }>;
            };

            const results = await Promise.allSettled(
              packages.map(async ({ package_name, registry }) => {
                const client = getRegistryClient(registry);
                const version = await client.getLatestVersion(package_name);
                return {
                  package: package_name,
                  registry,
                  latestVersion: version,
                  status: 'success',
                };
              })
            );

            const formattedResults = results.map((result, index) => {
              if (result.status === 'fulfilled') {
                return result.value;
              } else {
                return {
                  package: packages[index].package_name,
                  registry: packages[index].registry,
                  status: 'error',
                  error: result.reason.message,
                };
              }
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(formattedResults, null, 2),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: errorMessage }, null, 2),
            },
          ],
          isError: true,
        };
      }
    });

    return server;
  }

  private setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disable CSP for MCP compatibility
    }));

    // CORS support for web clients
    this.app.use(cors());

    // Rate limiting - 100 requests per 15 minutes per IP
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Too many requests from this IP, please try again later.'
        },
        id: null
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/mcp', limiter);

    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeSessions: Object.keys(this.transports).length,
        version: '1.0.0'
      });
    });

    // Readiness check
    this.app.get('/ready', (req, res) => {
      res.json({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    });

    // Main MCP endpoint - handles all StreamableHTTP transport
    this.app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string;

      try {
        if (sessionId && this.transports[sessionId]) {
          // Use existing transport
          const transport = this.transports[sessionId];
          await transport.handleRequest(req, res, req.body);
        } else if (!sessionId && this.isInitializeRequest(req.body)) {
          // Create new transport for initialize request
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID()
          });

          await this.server.connect(transport);
          await transport.handleRequest(req, res, req.body);

          // Store transport if session was created
          if (transport.sessionId) {
            this.transports[transport.sessionId] = transport;
          }
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32600,
              message: 'Invalid Request: missing or invalid session ID'
            },
            id: req.body?.id || null
          });
        }
      } catch (error) {
        console.error('MCP request error:', error);
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32002,
            message: 'Internal server error'
          },
          id: req.body?.id || null
        });
      }
    });

    // SSE endpoint for server-to-client streaming
    this.app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string;

      if (!sessionId || !this.transports[sessionId]) {
        return res.status(400).send('Invalid session');
      }

      const transport = this.transports[sessionId];
      await transport.handleRequest(req, res);
    });

    // Session cleanup endpoint
    this.app.delete('/mcp', (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string;
      if (sessionId && this.transports[sessionId]) {
        delete this.transports[sessionId];
        res.status(204).send();
      } else {
        res.status(400).json({ error: 'Invalid session' });
      }
    });
  }

  private isInitializeRequest(body: any): boolean {
    return body &&
           body.jsonrpc === '2.0' &&
           body.method === 'initialize' &&
           body.id !== undefined;
  }

  listen(port: number = 3000) {
    this.app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 MCP HTTP Server running on http://0.0.0.0:${port}`);
      console.log(`📊 Health check: http://0.0.0.0:${port}/health`);
      console.log(`🔧 MCP endpoint: http://0.0.0.0:${port}/mcp`);
    });
  }
}