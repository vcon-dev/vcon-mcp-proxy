# vCon MCP Proxy Design

> Architecture reference for `vcon-mcp-proxy`. For installation, quick start,
> and API surface, see the top-level [README.md](../README.md).

## Overview

`vcon-mcp-proxy` is a JavaScript/TypeScript proxy that wraps any MCP server to automatically capture MCP sessions as vCons and post them to a conserver. The proxy acts as middleware between MCP clients and servers, intercepting all tool calls and responses to build a complete conversation record per IETF vCon core-02 (syntax `0.4.0`).

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   MCP Client    │────▶│    vCon MCP Proxy    │────▶│   MCP Server    │
│  (Claude, etc)  │◀────│                      │◀────│  (any server)   │
└─────────────────┘     │  - Intercepts msgs   │     └─────────────────┘
                        │  - Builds vCon       │
                        │  - Posts to server   │     ┌─────────────────┐
                        │                      │────▶│   Conserver     │
                        └──────────────────────┘     │  (HTTP POST)    │
                                                     └─────────────────┘
```

## Key Components

### 1. Transport Wrapper (`src/transport/`)
- **StdioTransportWrapper**: Wraps STDIO transport to intercept all messages
- **HttpTransportWrapper**: Wraps HTTP transport for web-based MCP servers
- Both capture requests/responses bidirectionally

### 2. Session Manager (`src/session/`)
- **SessionManager**: Tracks active MCP sessions
- **Session**: Individual session state with message buffer
- Handles session lifecycle (start, messages, end)

### 3. vCon Builder (`src/vcon/`)
- **VconBuilder**: Constructs vCon from captured MCP messages
- Uses `vcon-js` library for IETF-compliant vCon creation
- Maps MCP concepts to vCon structure:
  - **Parties**: MCP client (user/assistant), MCP server (tools)
  - **Dialog**: Tool calls, tool responses, prompts, resources
  - **Analysis**: Optional AI analysis of the session
  - **Attachments**: Resource contents, large responses

### 4. Conserver Client (`src/conserver/`)
- **ConserverClient**: HTTP client for posting vCons
- Handles authentication, retries, error handling
- Supports configurable ingress lists

### 5. Proxy Core (`src/proxy/`)
- **VconMcpProxy**: Main proxy class
- Wraps existing MCP server or acts as proxy
- Configuration-driven behavior

## vCon Structure for MCP Sessions

```json
{
  "uuid": "generated-uuid",
  "vcon": "0.4.0",
  "created_at": "2025-01-15T10:00:00Z",
  "subject": "MCP Session: vcon-mcp-server",
  "parties": [
    {
      "name": "MCP Client",
      "role": "user",
      "meta": { "client_info": "Claude Desktop" }
    },
    {
      "name": "MCP Server",
      "role": "agent",
      "meta": { "server_name": "vcon-mcp", "version": "1.1.2" }
    }
  ],
  "dialog": [
    {
      "type": "text",
      "start": "2025-01-15T10:00:01Z",
      "parties": [0],
      "originator": 0,
      "body": "{\"method\":\"tools/call\",\"params\":{\"name\":\"create_vcon\"}}",
      "mediatype": "application/json",
      "encoding": "none",
      "meta": { "mcp_type": "request", "request_id": "123" }
    },
    {
      "type": "text",
      "start": "2025-01-15T10:00:02Z",
      "parties": [1],
      "originator": 1,
      "body": "{\"result\":{\"uuid\":\"abc-123\"}}",
      "mediatype": "application/json",
      "encoding": "none",
      "meta": { "mcp_type": "response", "request_id": "123" }
    }
  ],
  "analysis": [
    {
      "type": "session_summary",
      "vendor": "vcon-mcp-proxy",
      "dialog": [0, 1],
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
      "body": "[\"source:mcp-proxy\",\"server_name:vcon-mcp\",\"transport:stdio\"]"
    }
  ]
}
```

## File Structure

```
vcon-mcp-proxy/
├── src/
│   ├── index.ts                       # Main entry point and exports
│   ├── proxy/
│   │   ├── index.ts                   # VconMcpProxy main class
│   │   └── config.ts                  # Configuration types and defaults
│   ├── transport/
│   │   ├── index.ts                   # Transport wrapper exports
│   │   ├── intercepting-transport.ts  # Wraps an MCP Transport to capture messages
│   │   ├── message-parser.ts          # JSON-RPC message classification
│   │   └── stdio-wrapper.ts           # STDIO stream wrapper utilities
│   ├── session/
│   │   ├── index.ts                   # Session manager exports
│   │   ├── session-manager.ts         # Manages multiple sessions
│   │   └── session.ts                 # Individual session state
│   ├── vcon/
│   │   ├── index.ts                   # vCon builder exports
│   │   ├── builder.ts                 # VconBuilder class
│   │   └── mcp-mapper.ts              # MCP-to-vCon mapping (core-02 / 0.4.0)
│   └── conserver/
│       ├── index.ts                   # Conserver client exports
│       └── client.ts                  # HTTP client for conserver
├── examples/
│   ├── wrap-existing-server.ts        # Wrap an existing MCP server
│   ├── manual-session.ts              # Drive SessionManager + VconBuilder directly
│   └── with-vcon-mcp.ts               # Integration with vcon-mcp
├── tests/
│   ├── proxy.test.ts
│   ├── session.test.ts
│   ├── transport.test.ts
│   ├── vcon-builder.test.ts
│   ├── conserver-client.test.ts
│   └── integration.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

```json
{
  "dependencies": {
    "vcon-js": "^0.3.0",
    "@modelcontextprotocol/sdk": "^1.19.1",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

## Configuration Example

```typescript
const proxy = new VconMcpProxy({
  // Conserver settings
  conserver: {
    url: 'http://localhost:8000/api/vcon',
    apiToken: process.env.CONSERVER_API_TOKEN,
    ingressList: 'mcp_sessions',
  },

  // Session settings
  session: {
    timeoutMs: 300000, // 5 minutes
    maxMessages: 1000,
    captureResources: true,
  },

  // vCon settings
  vcon: {
    serverName: 'my-mcp-server',
    addAnalysis: true,
    tags: {
      environment: 'production',
    },
  },
});
```

## Usage Example: Wrap Existing MCP Server

```typescript
import { VconMcpProxy } from 'vcon-mcp-proxy';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Create your MCP server
const server = new Server({ name: 'my-server', version: '1.0.0' }, { ... });

// Wrap with vCon MCP proxy
const proxy = new VconMcpProxy({
  conserver: { url: 'http://localhost:8000/api/vcon' }
});

// Wrap the transport and connect
const transport = new StdioServerTransport();
const wrappedTransport = proxy.wrapTransport(transport);
await server.connect(wrappedTransport);
```

See `examples/wrap-existing-server.ts` for the full version, and
`examples/manual-session.ts` for driving `SessionManager` + `VconBuilder`
directly without an MCP transport.

## Session Lifecycle

1. **Session Start**: First message from client triggers new session
2. **Message Capture**: All requests/responses added to session buffer
3. **Session End**: Triggered by:
   - Client disconnect
   - Session timeout
   - Explicit end signal
   - Error condition
4. **vCon Creation**: Build vCon from session buffer
5. **Post to Conserver**: HTTP POST with retry logic
6. **Cleanup**: Clear session state

## Error Handling

- Transport errors: Log and continue (don't block MCP communication)
- vCon build errors: Log, save partial vCon if possible
- Conserver errors: Queue for retry, persist to disk if needed
- Session errors: Graceful degradation, log diagnostics

## Future Enhancements

- WebSocket transport support
- Real-time streaming to conserver
- Filtering rules for sensitive data
- Multiple conserver targets
- Plugin system for custom transformations
