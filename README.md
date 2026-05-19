# vCon MCP Proxy

Proxy to capture MCP (Model Context Protocol) sessions as vCons and post them to a conserver for storage and processing.

## Overview

This proxy wraps any MCP server to automatically capture all communication between MCP clients (like Claude Desktop) and servers. Each session is converted into an IETF-compliant vCon (Virtual Conversation) and posted to a conserver.

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   MCP Client    │────▶│  vCon MCP Proxy    │────▶│   MCP Server    │
│  (Claude, etc)  │◀────│                      │◀────│  (any server)   │
└─────────────────┘     │  - Intercepts msgs   │     └─────────────────┘
                        │  - Builds vCon       │
                        │  - Posts to server   │     ┌─────────────────┐
                        │                      │────▶│   Conserver     │
                        └──────────────────────┘     │  (HTTP POST)    │
                                                     └─────────────────┘
```

## Installation

```bash
npm install vcon-mcp-proxy
```

Optional peer dependency for full vCon library support:

```bash
npm install vcon-js
```

## Quick Start

### Wrap an Existing MCP Server

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VconMcpProxy } from 'vcon-mcp-proxy';

// Create your MCP server as usual
const server = new Server(
  { name: 'my-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Register your handlers...
server.setRequestHandler(/* ... */);

// Create the vCon MCP proxy
const adapter = new VconMcpProxy({
  conserver: {
    url: 'http://localhost:8000/api/vcon',
    apiToken: process.env.CONSERVER_API_TOKEN,
  },
  vcon: {
    serverName: 'my-server',
  },
});

// Create and wrap the transport
const transport = new StdioServerTransport();
const wrappedTransport = adapter.wrapTransport(transport);

// Connect with wrapped transport
await server.connect(wrappedTransport);

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await adapter.shutdown();
  process.exit(0);
});
```

## Configuration

### Full Configuration Options

```typescript
const adapter = new VconMcpProxy({
  // Required: Conserver settings
  conserver: {
    url: 'http://localhost:8000/api/vcon',  // Required
    apiToken: 'your-token',                  // Optional
    ingressList: 'mcp_sessions',             // Default: 'mcp_sessions'
    timeoutMs: 30000,                        // Default: 30000
    retryAttempts: 3,                        // Default: 3
    retryDelayMs: 1000,                      // Default: 1000
  },

  // Optional: Session settings
  session: {
    timeoutMs: 300000,           // Auto-finalize after 5 min inactivity
    maxMessages: 10000,          // Maximum messages per session
    captureResources: true,      // Capture resource content
    capturePrompts: true,        // Capture prompt content
    maxInlineContentSize: 100000, // Max inline content size (bytes)
  },

  // Optional: vCon generation settings
  vcon: {
    serverName: 'my-server',     // Server name in vCon
    serverVersion: '1.0.0',      // Server version
    addAnalysis: true,           // Add session analysis
    tags: {                      // Additional tags
      environment: 'production',
    },
    analysisVendor: 'vcon-mcp-proxy',
  },

  // Optional: Debug settings
  debug: false,
  logger: (level, message, data) => console.error(`[${level}] ${message}`, data),
});
```

### Environment Variables

The proxy works well with environment variables:

```bash
CONSERVER_URL=http://localhost:8000/api/vcon
CONSERVER_API_TOKEN=your-token
VCON_SERVER_NAME=my-server
DEBUG=true
```

## Events

The proxy emits events you can listen to:

```typescript
// Session started
adapter.on('session:start', (session) => {
  console.log(`Session started: ${session.id}`);
});

// Session ended
adapter.on('session:end', (session) => {
  console.log(`Session ended: ${session.id}`);
  console.log('Stats:', session.getStats());
});

// vCon created from session
adapter.on('vcon:created', (vcon, session) => {
  console.log(`vCon created: ${vcon.uuid}`);
  console.log(`Dialog count: ${vcon.dialog.length}`);
});

// vCon posted to conserver
adapter.on('vcon:posted', (result, vcon) => {
  if (result.success) {
    console.log(`Posted: ${vcon.uuid}`);
  } else {
    console.error(`Failed: ${result.message}`);
  }
});

// Error during vCon processing
adapter.on('vcon:error', (error, session) => {
  console.error(`Error for session ${session.id}:`, error);
});
```

## vCon Structure

Each MCP session is converted to a vCon with the following structure:

```json
{
  "uuid": "generated-uuid",
  "vcon": "0.4.0",
  "created_at": "2025-01-15T10:00:00Z",
  "subject": "MCP Session: my-server",
  "parties": [
    {
      "name": "Claude Desktop",
      "role": "user",
      "meta": { "version": "1.0.0" }
    },
    {
      "name": "my-server",
      "role": "agent",
      "meta": { "version": "1.0.0" }
    }
  ],
  "dialog": [
    {
      "type": "text",
      "start": "2025-01-15T10:00:01Z",
      "parties": [0],
      "originator": 0,
      "body": "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",...}",
      "mediatype": "application/json",
      "encoding": "none",
      "meta": {
        "mcp_type": "request",
        "mcp_method": "tools/call",
        "request_id": 1
      }
    }
  ],
  "analysis": [
    {
      "type": "session_summary",
      "vendor": "vcon-mcp-proxy",
      "product": "vcon-mcp-proxy",
      "dialog": [0, 1, 2],
      "body": "{\"tool_calls\":5,\"duration_ms\":1234}",
      "encoding": "json"
    }
  ],
  "attachments": [
    {
      "purpose": "tags",
      "party": 0,
      "dialog": 0,
      "encoding": "json",
      "body": "[\"source:mcp-proxy\",\"server_name:my-server\",\"tool_count:5\"]"
    }
  ]
}
```

## Manual Session Management

For custom integrations, you can manage sessions manually:

```typescript
import { SessionManager, VconBuilder, ConserverClient } from 'vcon-mcp-proxy';

const sessionManager = new SessionManager({ timeoutMs: 300000, ... });
const vconBuilder = new VconBuilder({ serverName: 'custom', ... });
const client = new ConserverClient({ url: '...', ... });

// Add messages
sessionManager.addMessage('request', { jsonrpc: '2.0', ... }, { sessionId: 'my-session' });
sessionManager.addMessage('response', { jsonrpc: '2.0', ... }, { sessionId: 'my-session' });

// Handle session end
sessionManager.on('session:end', async (session) => {
  const vcon = vconBuilder.build(session);
  await client.post(vcon);
});

// End session
sessionManager.endSession('my-session');
```

## API Reference

### VconMcpProxy

Main proxy class.

- `constructor(config: ProxyConfigInput)` - Create proxy
- `wrapTransport(transport: Transport, sessionId?: string)` - Wrap MCP transport
- `endSession(sessionId?: string)` - Manually end a session
- `endAllSessions()` - End all active sessions
- `shutdown()` - Graceful shutdown
- `getConfig()` - Get current configuration
- `getSessionManager()` - Access session manager
- `getVconBuilder()` - Access vCon builder
- `getConserverClient()` - Access conserver client

### SessionManager

Manages MCP sessions.

- `getOrCreateSession(sessionId?, options?)` - Get or create session
- `addMessage(direction, content, options?)` - Add message to session
- `endSession(sessionId?)` - End a session
- `endAllSessions()` - End all sessions
- Events: `session:start`, `session:end`, `session:timeout`, `session:error`, `session:message`

### VconBuilder

Builds vCons from sessions.

- `build(session: Session)` - Build vCon from session
- `toJson(vcon)` - Convert to JSON string
- `static isVconJsAvailable()` - Check if vcon-js library is available

### ConserverClient

HTTP client for conserver.

- `post(vcon)` - Post vCon to conserver
- `healthCheck()` - Check conserver health

## License

MIT
