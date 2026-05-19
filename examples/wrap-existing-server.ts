/**
 * Example: Wrap an existing MCP server with vCon adapter
 *
 * This example shows how to add vCon capture to any existing MCP server
 * by wrapping the transport.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VconMcpProxy } from '../src/index.js';

// Create your MCP server as usual
const server = new Server(
  {
    name: 'example-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register your tools, resources, prompts, etc.
server.setRequestHandler(
  { method: 'tools/list' } as any,
  async () => ({
    tools: [
      {
        name: 'hello',
        description: 'Say hello',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' },
          },
          required: ['name'],
        },
      },
    ],
  })
);

server.setRequestHandler(
  { method: 'tools/call' } as any,
  async (request: any) => {
    if (request.params.name === 'hello') {
      const name = request.params.arguments?.name || 'World';
      return {
        content: [
          {
            type: 'text',
            text: `Hello, ${name}!`,
          },
        ],
      };
    }
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
);

// Create the vCon MCP proxy
const adapter = new VconMcpProxy({
  conserver: {
    url: process.env.CONSERVER_URL || 'http://localhost:8000/api/vcon',
    apiToken: process.env.CONSERVER_API_TOKEN,
    ingressList: 'mcp_sessions',
  },
  vcon: {
    serverName: 'example-server',
    serverVersion: '1.0.0',
    addAnalysis: true,
    tags: {
      environment: process.env.NODE_ENV || 'development',
    },
  },
  session: {
    timeoutMs: 300000, // 5 minutes
  },
  debug: process.env.DEBUG === 'true',
});

// Listen for vCon events
adapter.on('session:start', (session) => {
  console.error(`[vCon] Session started: ${session.id}`);
});

adapter.on('vcon:created', (vcon) => {
  console.error(`[vCon] Created vCon: ${vcon.uuid}`);
});

adapter.on('vcon:posted', (result, vcon) => {
  if (result.success) {
    console.error(`[vCon] Posted to conserver: ${vcon.uuid}`);
  } else {
    console.error(`[vCon] Failed to post: ${result.message}`);
  }
});

// Create the transport and wrap it
const transport = new StdioServerTransport();
const wrappedTransport = adapter.wrapTransport(transport);

// Connect with wrapped transport
await server.connect(wrappedTransport);

console.error('[Server] MCP server started with vCon capture');

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.error('[Server] Shutting down...');
  await adapter.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('[Server] Shutting down...');
  await adapter.shutdown();
  process.exit(0);
});
