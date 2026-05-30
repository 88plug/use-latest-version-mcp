#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server-factory.js';
import { MCPHTTPServer } from './http-server.js';
import { packageCache } from './utils.js';

// Held so the shutdown handler can close it gracefully in HTTP mode.
let httpServer: MCPHTTPServer | undefined;
let shuttingDown = false;

async function main() {
  const transportType = process.argv[2] || 'stdio';
  const port = parseInt(process.env.PORT || '3000', 10);

  if (transportType === 'http') {
    httpServer = new MCPHTTPServer();
    httpServer.listen(port);
  } else {
    // Default stdio transport for backward compatibility
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Use Latest Version MCP Server running on stdio');
  }
}

// Graceful shutdown handler. exitCode is 0 for an expected signal and 1 when
// triggered by an unexpected fault (uncaught exception / unhandled rejection).
async function shutdown(signal: string, exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`\n${signal} received, shutting down gracefully...`);

  // Force exit if graceful shutdown stalls.
  const shutdownTimeout = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(exitCode || 1);
  }, 10000);
  shutdownTimeout.unref();

  try {
    if (httpServer) {
      await httpServer.close();
    }
    const cleaned = packageCache.cleanup();
    console.error(`Cleaned up ${cleaned} expired cache entries`);
    console.error('Graceful shutdown complete');
    clearTimeout(shutdownTimeout);
    process.exit(exitCode);
  } catch (error) {
    console.error('Error during shutdown:', error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));

// Handle uncaught errors — these are faults, so exit non-zero.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection', 1);
});

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
