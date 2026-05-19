/**
 * vCon MCP Proxy
 *
 * Proxy to capture MCP (Model Context Protocol) sessions as vCons
 * and post them to a conserver for storage and processing.
 *
 * @example
 * ```typescript
 * import { VconMcpProxy } from 'vcon-mcp-proxy';
 * import { Server } from '@modelcontextprotocol/sdk/server/index.js';
 * import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
 *
 * // Create your MCP server
 * const server = new Server({ name: 'my-server', version: '1.0.0' }, { ... });
 *
 * // Create the vCon MCP proxy
 * const adapter = new VconMcpProxy({
 *   conserver: {
 *     url: 'http://localhost:8000/api/vcon',
 *     apiToken: process.env.CONSERVER_TOKEN,
 *   },
 *   vcon: {
 *     serverName: 'my-server',
 *   },
 * });
 *
 * // Create and wrap the transport
 * const transport = new StdioServerTransport();
 * const wrappedTransport = adapter.wrapTransport(transport);
 *
 * // Connect with wrapped transport
 * await server.connect(wrappedTransport);
 *
 * // On shutdown, end all sessions
 * process.on('SIGINT', async () => {
 *   await adapter.shutdown();
 *   process.exit(0);
 * });
 * ```
 *
 * @packageDocumentation
 */

// Main proxy
export { VconMcpProxy } from './proxy/index.js';
export type {
  VconMcpProxyEvents,
} from './proxy/index.js';

// Configuration
export {
  parseConfig,
  defaultLogger,
} from './proxy/config.js';
export type {
  ProxyConfig,
  ProxyConfigInput,
  ConserverConfig,
  SessionConfig,
  VconConfig,
} from './proxy/config.js';

// Session management
export {
  Session,
  SessionManager,
} from './session/index.js';
export type {
  CapturedMessage,
  MessageDirection,
  McpMessageType,
  SessionParty,
  SessionState,
  SessionStats,
  SessionManagerEvents,
} from './session/index.js';

// Transport wrappers
export {
  InterceptingTransport,
  wrapTransport,
  StdioWrapper,
  createProxyStreams,
  MessageBuffer,
  parseMessage,
} from './transport/index.js';
export type {
  ParsedMessage,
  StdioWrapperEvents,
  ProxyStreams,
  InterceptingTransportEvents,
} from './transport/index.js';

// vCon builder
export {
  VconBuilder,
  createBuilder,
  mapSessionToVcon,
  mapParty,
  mapMessageToDialog,
  createSessionAnalysis,
  createTags,
  extractToolNames,
  extractResourceUris,
} from './vcon/index.js';
export type {
  VconData,
  VconParty,
  VconDialog,
  VconAnalysis,
  VconAttachment,
} from './vcon/index.js';

// Conserver client
export {
  ConserverClient,
  ConserverError,
  createClient,
} from './conserver/index.js';
export type {
  PostResult,
} from './conserver/index.js';
