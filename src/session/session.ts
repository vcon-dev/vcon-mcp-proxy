/**
 * Individual MCP session state
 */

import { v4 as uuidv4 } from 'uuid';
import type { SessionConfig } from '../proxy/config.js';

/**
 * MCP message types we track
 */
export type McpMessageType =
  | 'initialize'
  | 'initialized'
  | 'tools/list'
  | 'tools/call'
  | 'resources/list'
  | 'resources/read'
  | 'prompts/list'
  | 'prompts/get'
  | 'ping'
  | 'notifications/initialized'
  | 'notifications/progress'
  | 'notifications/message'
  | 'notifications/resources/updated'
  | 'notifications/resources/list_changed'
  | 'notifications/tools/list_changed'
  | 'notifications/prompts/list_changed'
  | 'unknown';

/**
 * Direction of message flow
 */
export type MessageDirection = 'request' | 'response' | 'notification';

/**
 * Captured MCP message
 */
export interface CapturedMessage {
  /** Unique message ID */
  id: string;
  /** Timestamp when message was captured */
  timestamp: Date;
  /** Direction of the message */
  direction: MessageDirection;
  /** MCP method/type */
  method: McpMessageType | string;
  /** JSON-RPC request ID (if applicable) */
  requestId?: string | number;
  /** Full message content */
  content: unknown;
  /** Size in bytes (approximate) */
  sizeBytes: number;
}

/**
 * Session party information
 */
export interface SessionParty {
  name: string;
  role: 'client' | 'server';
  meta?: Record<string, unknown>;
}

/**
 * Session state
 */
export type SessionState = 'active' | 'finalizing' | 'finalized' | 'error';

/**
 * Individual MCP session
 */
export class Session {
  /** Unique session identifier */
  readonly id: string;
  /** Session UUID for vCon */
  readonly uuid: string;
  /** Session start time */
  readonly startedAt: Date;
  /** Session end time */
  endedAt?: Date;
  /** Current session state */
  state: SessionState = 'active';
  /** Captured messages */
  readonly messages: CapturedMessage[] = [];
  /** Client party information */
  clientParty: SessionParty;
  /** Server party information */
  serverParty: SessionParty;
  /** Session configuration */
  private config: SessionConfig;
  /** Timeout handle for auto-finalization */
  private timeoutHandle?: ReturnType<typeof setTimeout>;
  /** Callback for session timeout */
  private onTimeout?: () => void;
  /** Total bytes captured */
  private totalBytes: number = 0;
  /** Pending requests (for matching responses) */
  private pendingRequests: Map<string | number, CapturedMessage> = new Map();

  constructor(
    config: SessionConfig,
    options?: {
      id?: string;
      clientInfo?: Record<string, unknown>;
      serverInfo?: Record<string, unknown>;
      onTimeout?: () => void;
    }
  ) {
    this.id = options?.id || uuidv4();
    this.uuid = uuidv4();
    this.startedAt = new Date();
    this.config = config;
    this.onTimeout = options?.onTimeout;

    this.clientParty = {
      name: 'MCP Client',
      role: 'client',
      meta: options?.clientInfo,
    };

    this.serverParty = {
      name: 'MCP Server',
      role: 'server',
      meta: options?.serverInfo,
    };

    this.resetTimeout();
  }

  /**
   * Reset the inactivity timeout
   */
  private resetTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
    }

    if (this.state === 'active' && this.config.timeoutMs > 0) {
      this.timeoutHandle = setTimeout(() => {
        if (this.state === 'active' && this.onTimeout) {
          this.onTimeout();
        }
      }, this.config.timeoutMs);
    }
  }

  /**
   * Clear the timeout
   */
  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
  }

  /**
   * Add a captured message to the session
   */
  addMessage(
    direction: MessageDirection,
    content: unknown,
    options?: {
      method?: string;
      requestId?: string | number;
    }
  ): CapturedMessage | null {
    if (this.state !== 'active') {
      return null;
    }

    // Check message limit
    if (this.messages.length >= this.config.maxMessages) {
      return null;
    }

    const contentStr = JSON.stringify(content);
    const sizeBytes = Buffer.byteLength(contentStr, 'utf-8');

    // Determine method from content or options
    const method = options?.method || this.extractMethod(content);
    const requestId = options?.requestId || this.extractRequestId(content);

    const message: CapturedMessage = {
      id: uuidv4(),
      timestamp: new Date(),
      direction,
      method,
      requestId,
      content,
      sizeBytes,
    };

    this.messages.push(message);
    this.totalBytes += sizeBytes;

    // Track pending requests for response matching
    if (direction === 'request' && requestId !== undefined) {
      this.pendingRequests.set(requestId, message);
    } else if (direction === 'response' && requestId !== undefined) {
      this.pendingRequests.delete(requestId);
    }

    // Update client/server info from initialize messages
    this.updatePartyInfo(message);

    this.resetTimeout();
    return message;
  }

  /**
   * Extract method from JSON-RPC message
   */
  private extractMethod(content: unknown): McpMessageType | string {
    if (typeof content === 'object' && content !== null) {
      const msg = content as Record<string, unknown>;
      if (typeof msg.method === 'string') {
        return msg.method;
      }
    }
    return 'unknown';
  }

  /**
   * Extract request ID from JSON-RPC message
   */
  private extractRequestId(content: unknown): string | number | undefined {
    if (typeof content === 'object' && content !== null) {
      const msg = content as Record<string, unknown>;
      if (typeof msg.id === 'string' || typeof msg.id === 'number') {
        return msg.id;
      }
    }
    return undefined;
  }

  /**
   * Update party information from initialize messages
   */
  private updatePartyInfo(message: CapturedMessage): void {
    if (message.method === 'initialize' && message.direction === 'request') {
      const content = message.content as Record<string, unknown>;
      const clientInfo = content.params as Record<string, unknown> | undefined;
      if (clientInfo?.clientInfo) {
        const info = clientInfo.clientInfo as Record<string, unknown>;
        this.clientParty.name = (info.name as string) || 'MCP Client';
        this.clientParty.meta = {
          ...this.clientParty.meta,
          ...info,
        };
      }
    }

    // For responses, check if it's a response to an initialize request
    if (message.direction === 'response' && message.requestId !== undefined) {
      const content = message.content as Record<string, unknown>;
      const result = content.result as Record<string, unknown> | undefined;

      // Check if serverInfo is present (indicates initialize response)
      if (result?.serverInfo) {
        const info = result.serverInfo as Record<string, unknown>;
        this.serverParty.name = (info.name as string) || 'MCP Server';
        this.serverParty.meta = {
          ...this.serverParty.meta,
          ...info,
        };
      }
    }
  }

  /**
   * Get session duration in milliseconds
   */
  getDurationMs(): number {
    const endTime = this.endedAt || new Date();
    return endTime.getTime() - this.startedAt.getTime();
  }

  /**
   * Get session statistics
   */
  getStats(): SessionStats {
    const toolCalls = this.messages.filter(
      (m) => m.method === 'tools/call' && m.direction === 'request'
    ).length;

    const resourceReads = this.messages.filter(
      (m) => m.method === 'resources/read' && m.direction === 'request'
    ).length;

    const promptGets = this.messages.filter(
      (m) => m.method === 'prompts/get' && m.direction === 'request'
    ).length;

    const errors = this.messages.filter((m) => {
      if (m.direction !== 'response') return false;
      const content = m.content as Record<string, unknown>;
      return content.error !== undefined;
    }).length;

    return {
      messageCount: this.messages.length,
      totalBytes: this.totalBytes,
      durationMs: this.getDurationMs(),
      toolCalls,
      resourceReads,
      promptGets,
      errors,
    };
  }

  /**
   * Finalize the session (no more messages will be added)
   */
  finalize(): void {
    if (this.state !== 'active') {
      return;
    }

    this.state = 'finalizing';
    this.endedAt = new Date();
    this.clearTimeout();
  }

  /**
   * Mark session as fully finalized (vCon created and posted)
   */
  markFinalized(): void {
    this.state = 'finalized';
  }

  /**
   * Mark session as error state
   */
  markError(): void {
    this.state = 'error';
    this.clearTimeout();
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.clearTimeout();
    this.pendingRequests.clear();
  }
}

/**
 * Session statistics
 */
export interface SessionStats {
  messageCount: number;
  totalBytes: number;
  durationMs: number;
  toolCalls: number;
  resourceReads: number;
  promptGets: number;
  errors: number;
}
