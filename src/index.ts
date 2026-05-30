#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server-factory.js';
import { MCPHTTPServer } from './http-server.js';
import { packageCache } from './utils.js';

async function main() {
  const transportType = process.argv[2] || 'stdio';
  const port = parseInt(process.env.PORT || '3000', 10);

  if (transportType === 'http') {
    const httpServer = new MCPHTTPServer();
    httpServer.listen(port);
  } else {
    // Default stdio transport for backward compatibility
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Use Latest Version MCP Server running on stdio');
  }
}

// Graceful shutdown handler
async function shutdown(signal: string) {
  console.error(`\n${signal} received, shutting down gracefully...`);

  // Clean up cache
  const cleaned = packageCache.cleanup();
  console.error(`Cleaned up ${cleaned} expired cache entries`);

  // Give pending requests time to complete
  const shutdownTimeout = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);

  try {
    // Close server if running
    // Note: MCP server doesn't have a close method, but we can clean up resources
    console.error('Graceful shutdown complete');
    clearTimeout(shutdownTimeout);
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection');
});

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
