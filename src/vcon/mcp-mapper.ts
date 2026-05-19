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
 * vCon attachment entry (vCon core-02 / syntax 0.4.0)
 *
 * Per spec, `purpose` is required and replaces the legacy `type` field.
 * `party` and `dialog` indices are required; use 0 for vCon-level attachments
 * not tied to a specific party or dialog turn.
 */
export interface VconAttachment {
  purpose: string;
  party: number | number[];
  dialog: number | number[];
  body: string;
  encoding: 'json' | 'base64url';
  mediatype?: string;
  filename?: string;
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
 * Build the tags attachment for the vCon.
 *
 * Per vCon core-02, tags live in an attachment with `purpose: "tags"`,
 * not as a top-level object. Body is a JSON-encoded array of "key:value"
 * strings, matching the de-facto format produced by vcon-lib's `add_tag`
 * helper. Use `party: 0, dialog: 0` to indicate a vCon-level attachment.
 */
export function createTagsAttachment(
  session: Session,
  config: VconConfig
): VconAttachment {
  const stats = session.getStats();
  const toolNames = extractToolNames(session.messages);
  const resourceUris = extractResourceUris(session.messages);

  const tagMap: Record<string, string> = {
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

  const entries = Object.entries(tagMap).map(([k, v]) => `${k}:${v}`);

  return {
    purpose: 'tags',
    party: 0,
    dialog: 0,
    body: JSON.stringify(entries),
    encoding: 'json',
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

  // Create vCon structure (vCon core-02, syntax 0.4.0)
  const vcon: VconData = {
    uuid: session.uuid,
    vcon: '0.4.0',
    created_at: session.startedAt.toISOString(),
    updated_at: (session.endedAt || new Date()).toISOString(),
    subject: `MCP Session: ${config.serverName}`,
    parties,
    dialog,
    attachments: [createTagsAttachment(session, config)],
  };

  // Add analysis if configured
  if (config.addAnalysis && dialog.length > 0) {
    const stats = session.getStats();
    vcon.analysis = [createSessionAnalysis(stats, config, dialog.length)];
  }

  return vcon;
}
