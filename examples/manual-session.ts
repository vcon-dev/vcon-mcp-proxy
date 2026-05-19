/**
 * Example: Manual session management
 *
 * This example shows how to manually create and manage sessions
 * without wrapping a transport. Useful for custom integrations.
 */

import {
  SessionManager,
  VconBuilder,
  ConserverClient,
  type VconData,
} from '../src/index.js';

// Configuration
const config = {
  session: {
    timeoutMs: 300000,
    maxMessages: 10000,
    captureResources: true,
    capturePrompts: true,
    maxInlineContentSize: 100000,
  },
  vcon: {
    serverName: 'manual-example',
    serverVersion: '1.0.0',
    addAnalysis: true,
    tags: { example: 'manual-session' },
    analysisVendor: 'vcon-mcp-proxy',
  },
  conserver: {
    url: process.env.CONSERVER_URL || 'http://localhost:8000/api/vcon',
    apiToken: process.env.CONSERVER_API_TOKEN,
    ingressList: 'mcp_sessions',
    timeoutMs: 30000,
    retryAttempts: 3,
    retryDelayMs: 1000,
  },
};

// Create components
const sessionManager = new SessionManager(config.session);
const vconBuilder = new VconBuilder(config.vcon);
const conserverClient = new ConserverClient(config.conserver, (level, msg, data) => {
  console.error(`[${level}] ${msg}`, data || '');
});

// Handle session end
sessionManager.on('session:end', async (session) => {
  console.error(`Session ended: ${session.id}`);
  console.error('Stats:', session.getStats());

  // Build vCon
  const vcon = vconBuilder.build(session);
  console.error(`Created vCon: ${vcon.uuid}`);
  console.error(`Dialog count: ${vcon.dialog.length}`);

  // Post to conserver
  const result = await conserverClient.post(vcon);
  console.error('Post result:', result);

  // Clean up
  sessionManager.removeSession(session.id);
});

// Simulate an MCP session
async function simulateMcpSession() {
  const sessionId = 'test-session-1';

  // Simulate initialize request
  sessionManager.addMessage(
    'request',
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: {
          name: 'Test Client',
          version: '1.0.0',
        },
        capabilities: {},
      },
    },
    { sessionId }
  );

  // Simulate initialize response
  sessionManager.addMessage(
    'response',
    {
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'Manual Example Server',
          version: '1.0.0',
        },
        capabilities: {
          tools: {},
        },
      },
    },
    { sessionId }
  );

  // Simulate tools/list request
  sessionManager.addMessage(
    'request',
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    },
    { sessionId }
  );

  // Simulate tools/list response
  sessionManager.addMessage(
    'response',
    {
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [
          {
            name: 'example_tool',
            description: 'An example tool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    },
    { sessionId }
  );

  // Simulate tools/call request
  sessionManager.addMessage(
    'request',
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'example_tool',
        arguments: { input: 'test' },
      },
    },
    { sessionId }
  );

  // Simulate tools/call response
  sessionManager.addMessage(
    'response',
    {
      jsonrpc: '2.0',
      id: 3,
      result: {
        content: [
          {
            type: 'text',
            text: 'Tool result: Success!',
          },
        ],
      },
    },
    { sessionId }
  );

  // End the session
  console.error('Ending session...');
  sessionManager.endSession(sessionId);
}

// Run the simulation
simulateMcpSession().catch(console.error);
