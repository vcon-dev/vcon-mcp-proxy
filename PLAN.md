# vCon MCP Proxy Plan

## Overview

Create a JavaScript/TypeScript proxy that wraps any MCP server to automatically capture MCP sessions as vCons and post them to a conserver. The proxy acts as middleware between MCP clients and servers, intercepting all tool calls and responses to build a complete conversation record.

## Architecture

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
  "vcon": "0.0.1",
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
  "tags": {
    "source": "mcp-proxy",
    "server_name": "vcon-mcp",
    "transport": "stdio"
  }
}
```

## File Structure

```
vcon-mcp-proxy/
├── src/
│   ├── index.ts                 # Main entry point and exports
│   ├── adapter/
│   │   ├── index.ts             # VconMcpProxy main class
│   │   └── config.ts            # Configuration types and defaults
│   ├── transport/
│   │   ├── index.ts             # Transport wrapper exports
│   │   ├── stdio-wrapper.ts     # STDIO transport wrapper
│   │   └── http-wrapper.ts      # HTTP transport wrapper
│   ├── session/
│   │   ├── index.ts             # Session manager exports
│   │   ├── session-manager.ts   # Manages multiple sessions
│   │   └── session.ts           # Individual session state
│   ├── vcon/
│   │   ├── index.ts             # vCon builder exports
│   │   ├── builder.ts           # VconBuilder class
│   │   └── mcp-mapper.ts        # MCP to vCon mapping logic
│   └── conserver/
│       ├── index.ts             # Conserver client exports
│       └── client.ts            # HTTP client for conserver
├── examples/
│   ├── wrap-existing-server.ts  # Example: wrap existing MCP server
│   ├── standalone-proxy.ts      # Example: standalone proxy mode
│   └── with-vcon-mcp.ts         # Example: integration with vcon-mcp
├── tests/
│   ├── proxy.test.ts
│   ├── session.test.ts
│   ├── vcon-builder.test.ts
│   └── conserver-client.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Implementation Steps

### Step 1: Project Setup
- Initialize npm project with TypeScript
- Add dependencies: `vcon-js`, `@modelcontextprotocol/sdk`, `zod`
- Configure TypeScript for ES modules

### Step 2: Configuration System (`src/proxy/config.ts`)
- Define proxy configuration interface
- Conserver URL, API token, ingress list
- Session timeout, buffer size limits
- Optional filtering rules (which tools to capture)

### Step 3: Session Management (`src/session/`)
- SessionManager: Map of session ID to Session objects
- Session: Message buffer, start time, parties info
- Auto-finalize sessions after timeout or explicit end

### Step 4: Transport Wrappers (`src/transport/`)
- StdioTransportWrapper: Intercepts stdin/stdout
- Create proxy streams that capture + forward messages
- Parse JSON-RPC messages to identify types

### Step 5: vCon Builder (`src/vcon/`)
- Use vcon-js library to create compliant vCons
- Map MCP message types to dialog entries
- Add session metadata as tags and analysis

### Step 6: Conserver Client (`src/conserver/`)
- HTTP POST to conserver API
- Handle authentication headers
- Retry logic with exponential backoff

### Step 7: Main Proxy (`src/proxy/index.ts`)
- Combine all components
- Provide simple API for wrapping MCP servers
- Event emitters for session lifecycle

### Step 8: Testing
- Unit tests for each component
- Integration tests with mock MCP server
- Test vCon compliance

### Step 9: Examples and Documentation
- Working examples for common use cases
- README with setup instructions
- API documentation

## Dependencies

```json
{
  "dependencies": {
    "vcon-js": "^0.2.0",
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
const adapter = new VconMcpProxy({
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

## Usage Examples

### Wrap Existing MCP Server (Programmatic)

```typescript
import { VconMcpProxy } from 'vcon-mcp-proxy';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Create your MCP server
const server = new Server({ name: 'my-server', version: '1.0.0' }, { ... });

// Wrap with vCon MCP proxy
const adapter = new VconMcpProxy({
  conserver: { url: 'http://localhost:8000/api/vcon' }
});

// Start with wrapped transport
const wrappedTransport = adapter.wrapStdioTransport();
await server.connect(wrappedTransport);
```

### Standalone Proxy Mode

```typescript
import { VconMcpProxy } from 'vcon-mcp-proxy';

// Proxy between client and any MCP server
const proxy = new VconMcpProxy({
  conserver: { url: 'http://localhost:8000/api/vcon' },
  targetCommand: 'node',
  targetArgs: ['/path/to/mcp-server/index.js'],
});

await proxy.start();
```

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
