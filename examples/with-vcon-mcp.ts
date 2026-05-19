/**
 * Example: Integration with vcon-mcp server
 *
 * This example shows how to wrap the vcon-mcp server itself
 * to capture MCP sessions and post them to a conserver.
 *
 * This creates a "meta" scenario where vCon operations via MCP
 * are themselves recorded as vCons.
 */

import { VconMcpProxy } from '../src/index.js';

/**
 * To use this with vcon-mcp:
 *
 * 1. In your vcon-mcp server setup, import the proxy:
 *    import { VconMcpProxy } from 'vcon-mcp-proxy';
 *
 * 2. Before connecting the transport, wrap it:
 *    const adapter = new VconMcpProxy({ ... });
 *    const wrappedTransport = adapter.wrapTransport(transport);
 *    await server.connect(wrappedTransport);
 *
 * Example integration code for vcon-mcp/src/index.ts:
 */

const integrationCode = `
// In vcon-mcp/src/index.ts, add this after setupServer():

import { VconMcpProxy } from 'vcon-mcp-proxy';

// Create adapter if VCON_CAPTURE_ENABLED is set
let adapter: VconMcpProxy | null = null;

if (process.env.VCON_CAPTURE_ENABLED === 'true') {
  adapter = new VconMcpProxy({
    conserver: {
      url: process.env.VCON_CAPTURE_URL || 'http://localhost:8000/api/vcon',
      apiToken: process.env.VCON_CAPTURE_TOKEN,
      ingressList: process.env.VCON_CAPTURE_INGRESS || 'mcp_meta_sessions',
    },
    vcon: {
      serverName: 'vcon-mcp',
      serverVersion: '1.1.2',
      tags: {
        meta: 'true', // Mark as meta-vCon
      },
    },
    debug: process.env.MCP_DEBUG === 'true',
  });

  adapter.on('vcon:posted', (result, vcon) => {
    logWithContext('info', 'Meta vCon posted', {
      uuid: vcon.uuid,
      success: result.success,
    });
  });
}

// In the main() function, wrap the transport:
async function main() {
  try {
    const transportType = process.env.MCP_TRANSPORT || 'stdio';

    if (transportType === 'http') {
      // HTTP transport (adapter wrapping not yet supported for HTTP)
      const config = getHttpTransportConfig();
      const transport = createHttpTransport(config);
      httpServerInstance = await startHttpServer(serverContext.server, transport, config);
    } else {
      // STDIO transport - wrap with adapter if enabled
      const transport = new StdioServerTransport();
      const finalTransport = adapter
        ? adapter.wrapTransport(transport)
        : transport;
      await serverContext.server.connect(finalTransport);
    }
  } catch (error) {
    // ...
  }
}

// In shutdown handlers, also shutdown adapter:
process.on('SIGINT', async () => {
  if (adapter) {
    await adapter.shutdown();
  }
  // ... rest of shutdown
});
`;

console.log('Integration code for vcon-mcp:');
console.log(integrationCode);

// Demo of what the proxy configuration would look like
const demoConfig = {
  conserver: {
    url: 'http://localhost:8000/api/vcon',
    apiToken: 'your-token-here',
    ingressList: 'mcp_meta_sessions',
    timeoutMs: 30000,
    retryAttempts: 3,
  },
  vcon: {
    serverName: 'vcon-mcp',
    serverVersion: '1.1.2',
    addAnalysis: true,
    tags: {
      meta: 'true',
      source_type: 'vcon-operations',
    },
  },
  session: {
    timeoutMs: 600000, // 10 minutes for longer vCon operations
    maxMessages: 50000,
  },
  debug: false,
};

console.log('\nExample adapter configuration:');
console.log(JSON.stringify(demoConfig, null, 2));

// Create adapter instance to verify it works
const adapter = new VconMcpProxy({
  conserver: {
    url: 'http://localhost:8000/api/vcon',
  },
  vcon: {
    serverName: 'vcon-mcp-example',
  },
});

console.log("\nProxy created successfully");
console.log('Server name:', adapter.getConfig().vcon.serverName);
