# MCP Server - Use Latest Version (Docker)

A Docker containerized MCP (Model Context Protocol) server that provides real-time package version checking across multiple registries.

## Quick Start

```bash
# Run the server
docker run -p 3000:3000 cryptoandcoffee/mcp-server-use-latest-version:latest

# The server will be available at http://localhost:3000
```

## MCP Client Configuration

Configure your MCP-compatible client (Claude Desktop, VS Code, etc.) to connect to the server:

```json
{
  "mcpServers": {
    "use-latest-version": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Environment Variables

- `PORT`: Server port (default: 3000)

## Endpoints

- `GET /health` - Health check
- `GET /ready` - Readiness check
- `POST /mcp` - MCP protocol endpoint
- `GET /mcp` - SSE streaming endpoint
- `DELETE /mcp` - Session cleanup

## Supported Registries

The server supports 40+ package registries including:
- npm, PyPI, Maven, crates.io, RubyGems
- GitHub, DockerHub, GitLab releases
- And many more...

## Features

- ✅ Real-time version checking
- ✅ Installation command generation
- ✅ Version comparison
- ✅ Batch package checking
- ✅ Rate limiting for abuse prevention
- ✅ Session management for concurrent users
- ✅ Health monitoring

## Security

- Rate limiting (100 requests/15min per IP)
- Input validation and sanitization
- HTTPS recommended for production
- No authentication required (open access)

## Production Deployment

```bash
# With custom port
docker run -p 8080:3000 -e PORT=3000 cryptoandcoffee/mcp-server-use-latest-version:latest

# With Docker Compose
version: '3.8'
services:
  mcp-server:
    image: cryptoandcoffee/mcp-server-use-latest-version:latest
    ports:
      - "3000:3000"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Docker Image Details

- **Image**: `cryptoandcoffee/mcp-server-use-latest-version:latest`
- **Base**: Node.js 18 Alpine
- **Size**: ~150MB
- **Security**: Non-root user
- **Health Checks**: Built-in

## Troubleshooting

**Port already in use:**
```bash
# Use a different port
docker run -p 3001:3000 cryptoandcoffee/mcp-server-use-latest-version:latest
```

**Health check:**
```bash
curl http://localhost:3000/health
```

**Logs:**
```bash
docker logs <container-id>
```

## License

MIT