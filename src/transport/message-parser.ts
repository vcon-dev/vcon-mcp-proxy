/**
 * JSON-RPC message parser for MCP protocol
 */

import type { MessageDirection } from '../session/session.js';

/**
 * Parsed JSON-RPC message
 */
export interface ParsedMessage {
  /** The parsed JSON object */
  data: unknown;
  /** Direction (request, response, notification) */
  direction: MessageDirection;
  /** Method name (for requests/notifications) */
  method?: string;
  /** Request ID (for requests/responses) */
  requestId?: string | number;
  /** Whether this is an error response */
  isError?: boolean;
}

/**
 * JSON-RPC message structure
 */
interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

/**
 * Parse a JSON-RPC message and determine its direction
 */
export function parseMessage(data: unknown): ParsedMessage {
  if (typeof data !== 'object' || data === null) {
    return { data, direction: 'notification' };
  }

  const msg = data as JsonRpcMessage;

  // Request: has method and id
  if (msg.method !== undefined && msg.id !== undefined) {
    return {
      data,
      direction: 'request',
      method: msg.method,
      requestId: msg.id,
    };
  }

  // Notification: has method but no id
  if (msg.method !== undefined && msg.id === undefined) {
    return {
      data,
      direction: 'notification',
      method: msg.method,
    };
  }

  // Response: has id but no method, has result or error
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    return {
      data,
      direction: 'response',
      requestId: msg.id,
      isError: msg.error !== undefined,
    };
  }

  // Unknown format, treat as notification
  return { data, direction: 'notification' };
}

/**
 * Buffer for accumulating partial JSON messages from streams
 */
export class MessageBuffer {
  private buffer: string = '';

  /**
   * Add data to the buffer and extract complete messages
   */
  push(chunk: string | Buffer): unknown[] {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    return this.extractMessages();
  }

  /**
   * Extract complete JSON-RPC messages from buffer
   * Messages are separated by newlines in STDIO transport
   */
  private extractMessages(): unknown[] {
    const messages: unknown[] = [];
    const lines = this.buffer.split('\n');

    // Keep incomplete line in buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        messages.push(parsed);
      } catch {
        // Not valid JSON, might be partial or garbage
        // In strict MCP, we could log this, but for now skip
      }
    }

    return messages;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = '';
  }

  /**
   * Check if buffer has pending data
   */
  hasPending(): boolean {
    return this.buffer.trim().length > 0;
  }
}
