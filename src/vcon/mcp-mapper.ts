/**
 * MCP to vCon mapping logic
 * Maps MCP protocol concepts to vCon structure
 */

import type { Session, CapturedMessage, SessionParty, SessionStats } from '../session/session.js';
import type { VconConfig } from '../proxy/config.js';

/**
 * vCon party structure
 */
export interface VconParty {
  name: string;
  role?: string;
  meta?: Record<string, unknown>;
}

/**
 * vCon dialog entry
 */
export interface VconDialog {
  type: 'text';
  start: string;
  parties: number[];
  originator: number;
  body: string;
  mediatype: string;
  encoding: 'none' | 'json' | 'base64url';
  meta?: Record<string, unknown>;
}

/**
 * vCon analysis entry
 */
export interface VconAnalysis {
  type: string;
  vendor: string;
  product?: string;
  dialog: number | number[];
  body: string;
  encoding: 'json';
}

/**
 * vCon attachment entry
 */
export interface VconAttachment {
  type: string;
  purpose?: string;
  body: string;
  encoding: 'json' | 'base64url';
  mediatype?: string;
  filename?: string;
  dialog?: number | number[];
}

/**
 * Complete vCon data structure
 */
export interface VconData {
  uuid: string;
  vcon: string;
  created_at: string;
  updated_at?: string;
  subject?: string;
  parties: VconParty[];
  dialog: VconDialog[];
  analysis?: VconAnalysis[];
  attachments?: VconAttachment[];
  tags?: Record<string, string>;
}

/**
 * Map a session party to vCon party format
 */
export function mapParty(party: SessionParty): VconParty {
  return {
    name: party.name,
    role: party.role === 'client' ? 'user' : 'agent',
    meta: party.meta,
  };
}

/**
 * Map a captured message to vCon dialog format
 */
export function mapMessageToDialog(
  message: CapturedMessage,
  partyIndex: number
): VconDialog {
  const body = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);

  return {
    type: 'text',
    start: message.timestamp.toISOString(),
    parties: [partyIndex],
    originator: partyIndex,
    body,
    mediatype: 'application/json',
    encoding: 'none',
    meta: {
      mcp_type: message.direction,
      mcp_method: message.method,
      ...(message.requestId !== undefined && { request_id: message.requestId }),
      message_id: message.id,
    },
  };
}

/**
 * Create session analysis entry
 */
export function createSessionAnalysis(
  stats: SessionStats,
  config: VconConfig,
  dialogCount: number
): VconAnalysis {
  // Create dialog indices array for all dialogs
  const dialogIndices = Array.from({ length: dialogCount }, (_, i) => i);

  return {
    type: 'session_summary',
    vendor: config.analysisVendor,
    product: 'vcon-mcp-proxy',
    dialog: dialogIndices.length > 0 ? dialogIndices : 0,
    body: JSON.stringify({
      message_count: stats.messageCount,
      total_bytes: stats.totalBytes,
      duration_ms: stats.durationMs,
      tool_calls: stats.toolCalls,
      resource_reads: stats.resourceReads,
      prompt_gets: stats.promptGets,
      errors: stats.errors,
    }),
    encoding: 'json',
  };
}

/**
 * Extract tool names used in the session
 */
export function extractToolNames(messages: CapturedMessage[]): string[] {
  const toolNames = new Set<string>();

  for (const message of messages) {
    if (message.method === 'tools/call' && message.direction === 'request') {
      const content = message.content as Record<string, unknown>;
      const params = content.params as Record<string, unknown> | undefined;
      if (params?.name && typeof params.name === 'string') {
        toolNames.add(params.name);
      }
    }
  }

  return Array.from(toolNames);
}

/**
 * Extract resource URIs accessed in the session
 */
export function extractResourceUris(messages: CapturedMessage[]): string[] {
  const uris = new Set<string>();

  for (const message of messages) {
    if (message.method === 'resources/read' && message.direction === 'request') {
      const content = message.content as Record<string, unknown>;
      const params = content.params as Record<string, unknown> | undefined;
      if (params?.uri && typeof params.uri === 'string') {
        uris.add(params.uri);
      }
    }
  }

  return Array.from(uris);
}

/**
 * Create tags for the vCon
 */
export function createTags(
  session: Session,
  config: VconConfig
): Record<string, string> {
  const stats = session.getStats();
  const toolNames = extractToolNames(session.messages);
  const resourceUris = extractResourceUris(session.messages);

  return {
    source: 'mcp-proxy',
    server_name: config.serverName,
    ...(config.serverVersion && { server_version: config.serverVersion }),
    session_id: session.id,
    tool_count: String(stats.toolCalls),
    resource_count: String(stats.resourceReads),
    ...(toolNames.length > 0 && { tools_used: toolNames.join(',') }),
    ...(resourceUris.length > 0 && { resources_accessed: resourceUris.slice(0, 5).join(',') }),
    ...config.tags,
  };
}

/**
 * Map a complete session to vCon data structure
 */
export function mapSessionToVcon(
  session: Session,
  config: VconConfig
): VconData {
  // Create parties (index 0 = client, index 1 = server)
  const parties: VconParty[] = [
    mapParty(session.clientParty),
    mapParty(session.serverParty),
  ];

  // Map messages to dialog entries
  const dialog: VconDialog[] = session.messages.map((message) => {
    // Client messages (requests) come from party 0
    // Server messages (responses) come from party 1
    const partyIndex = message.direction === 'response' ? 1 : 0;
    return mapMessageToDialog(message, partyIndex);
  });

  // Create vCon structure
  const vcon: VconData = {
    uuid: session.uuid,
    vcon: '0.0.1',
    created_at: session.startedAt.toISOString(),
    updated_at: (session.endedAt || new Date()).toISOString(),
    subject: `MCP Session: ${config.serverName}`,
    parties,
    dialog,
    tags: createTags(session, config),
  };

  // Add analysis if configured
  if (config.addAnalysis && dialog.length > 0) {
    const stats = session.getStats();
    vcon.analysis = [createSessionAnalysis(stats, config, dialog.length)];
  }

  return vcon;
}
