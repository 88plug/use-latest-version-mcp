import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import type { Server as HttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpServer } from './server-factory.js';
import { randomUUID } from 'crypto';

// Production configuration via environment (all optional, with safe defaults).
const HOST = process.env.HOST || '0.0.0.0';
// Comma-separated allow-list of CORS origins. When unset, all origins are
// reflected (backward-compatible open default); set it to lock the server down.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : undefined;
// Cap on concurrent sessions to bound memory if a client never sends DELETE.
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '1000', 10);
// Set TRUST_PROXY (e.g. "1" or "true") when running behind a reverse proxy so
// express-rate-limit keys on the real client IP from X-Forwarded-For.
const TRUST_PROXY = process.env.TRUST_PROXY;

export class MCPHTTPServer {
  private app: express.Application;
  private server: Server;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
  private httpServer?: HttpServer;

  constructor() {
    this.app = express();
    // Build the MCP server from the shared factory so the HTTP transport always
    // exposes exactly the same tool set as the stdio transport.
    this.server = createMcpServer();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    if (TRUST_PROXY !== undefined) {
      // Number ("1") => trust N hops; otherwise pass the raw value through.
      const n = Number(TRUST_PROXY);
      this.app.set('trust proxy', Number.isNaN(n) ? TRUST_PROXY : n);
    }

    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disable CSP for MCP compatibility
    }));

    // CORS — locked to ALLOWED_ORIGINS when configured, otherwise open.
    this.app.use(cors(ALLOWED_ORIGINS ? { origin: ALLOWED_ORIGINS } : {}));

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
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeSessions: Object.keys(this.transports).length,
        version: '1.0.0'
      });
    });

    // Readiness check
    this.app.get('/ready', (_req, res) => {
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
          // Refuse new sessions once the cap is reached so a flood of un-closed
          // sessions cannot exhaust memory.
          if (Object.keys(this.transports).length >= MAX_SESSIONS) {
            res.status(503).json({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Server at session capacity, try again later.' },
              id: req.body?.id ?? null,
            });
            return;
          }

          // Create new transport for initialize request
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID()
          });

          // Evict the transport from the registry when its session ends so the
          // map does not grow without bound.
          transport.onclose = () => {
            if (transport.sessionId) {
              delete this.transports[transport.sessionId];
            }
          };

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
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32002,
              message: 'Internal server error'
            },
            id: req.body?.id || null
          });
        }
      }
    });

    // SSE endpoint for server-to-client streaming
    this.app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string;

      if (!sessionId || !this.transports[sessionId]) {
        res.status(400).send('Invalid session');
        return;
      }

      const transport = this.transports[sessionId];
      await transport.handleRequest(req, res);
    });

    // Session cleanup endpoint — route through the transport so the SDK
    // terminates the session cleanly (its onclose handler evicts the entry).
    this.app.delete('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string;
      const transport = sessionId ? this.transports[sessionId] : undefined;
      if (!transport) {
        res.status(400).json({ error: 'Invalid session' });
        return;
      }
      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error('MCP session-close error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to close session' });
        }
      }
    });
  }

  private isInitializeRequest(body: any): boolean {
    return body &&
           body.jsonrpc === '2.0' &&
           body.method === 'initialize' &&
           body.id !== undefined;
  }

  listen(port: number = 3000): void {
    this.httpServer = this.app.listen(port, HOST, () => {
      console.log(`🚀 MCP HTTP Server running on http://${HOST}:${port}`);
      console.log(`📊 Health check: http://${HOST}:${port}/health`);
      console.log(`🔧 MCP endpoint: http://${HOST}:${port}/mcp`);
    });
  }

  /** Close all active transports and stop accepting connections. */
  async close(): Promise<void> {
    for (const transport of Object.values(this.transports)) {
      try {
        await transport.close();
      } catch {
        // best-effort cleanup
      }
    }
    this.transports = {};
    await new Promise<void>((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
