import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpServer } from './server-factory.js';
import { randomUUID } from 'crypto';

export class MCPHTTPServer {
  private app: express.Application;
  private server: Server;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  constructor() {
    this.app = express();
    // Build the MCP server from the shared factory so the HTTP transport always
    // exposes exactly the same tool set as the stdio transport.
    this.server = createMcpServer();
    this.setupMiddleware();
    this.setupRoutes();
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