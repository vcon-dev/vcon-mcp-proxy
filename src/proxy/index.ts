/**
 * vCon MCP Proxy
 * Main proxy class that wraps MCP servers to capture sessions as vCons
 */

import { EventEmitter } from 'events';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  parseConfig,
  defaultLogger,
  type ProxyConfig,
  type ProxyConfigInput,
} from './config.js';
import { SessionManager, type Session } from '../session/index.js';
import { InterceptingTransport, wrapTransport, type ParsedMessage } from '../transport/index.js';
import { VconBuilder, type VconData } from '../vcon/index.js';
import { ConserverClient, type PostResult } from '../conserver/index.js';

/**
 * Events emitted by VconMcpProxy
 */
export interface VconMcpProxyEvents {
  'session:start': (session: Session) => void;
  'session:end': (session: Session) => void;
  'vcon:created': (vcon: VconData, session: Session) => void;
  'vcon:posted': (result: PostResult, vcon: VconData) => void;
  'vcon:error': (error: Error, session: Session) => void;
  'error': (error: Error) => void;
}

/**
 * vCon MCP Proxy
 * Wraps MCP transports to capture sessions and post them to a conserver
 */
export class VconMcpProxy extends EventEmitter {
  private config: ProxyConfig;
  private sessionManager: SessionManager;
  private vconBuilder: VconBuilder;
  private conserverClient: ConserverClient;
  private logger: (level: string, message: string, data?: unknown) => void;
  private wrappedTransports: Set<InterceptingTransport> = new Set();

  constructor(configInput: ProxyConfigInput) {
    super();

    // Parse and validate configuration
    this.config = parseConfig(configInput);

    // Set up logger
    this.logger = this.config.logger || (this.config.debug ? defaultLogger : () => {});

    // Initialize components
    this.sessionManager = new SessionManager(this.config.session);
    this.vconBuilder = new VconBuilder(this.config.vcon);
    this.conserverClient = new ConserverClient(this.config.conserver, this.logger);

    // Set up session event handlers
    this.setupSessionHandlers();

    this.logger('info', 'vCon MCP Proxy initialized', {
      serverName: this.config.vcon.serverName,
      conserverUrl: this.config.conserver.url,
    });
  }

  /**
   * Set up session event handlers
   */
  private setupSessionHandlers(): void {
    this.sessionManager.on('session:start', (session) => {
      this.logger('info', 'Session started', { sessionId: session.id });
      this.emit('session:start', session);
    });

    this.sessionManager.on('session:end', async (session) => {
      this.logger('info', 'Session ended', {
        sessionId: session.id,
        stats: session.getStats(),
      });
      this.emit('session:end', session);

      // Build and post vCon
      await this.processSession(session);
    });

    this.sessionManager.on('session:timeout', (session) => {
      this.logger('info', 'Session timed out', { sessionId: session.id });
    });

    this.sessionManager.on('session:error', (session, error) => {
      this.logger('error', 'Session error', {
        sessionId: session.id,
        error: error.message,
      });
      this.emit('error', error);
    });
  }

  /**
   * Process a completed session: build vCon and post to conserver
   */
  private async processSession(session: Session): Promise<void> {
    try {
      // Build vCon from session
      const vcon = this.vconBuilder.build(session);
      this.logger('debug', 'vCon created', {
        uuid: vcon.uuid,
        dialogCount: vcon.dialog.length,
      });
      this.emit('vcon:created', vcon, session);

      // Post to conserver
      const result = await this.conserverClient.post(vcon);

      if (result.success) {
        this.logger('info', 'vCon posted to conserver', {
          uuid: vcon.uuid,
          statusCode: result.statusCode,
        });
        session.markFinalized();
      } else {
        this.logger('error', 'Failed to post vCon to conserver', {
          uuid: vcon.uuid,
          message: result.message,
          retryCount: result.retryCount,
        });
        session.markError();
      }

      this.emit('vcon:posted', result, vcon);

      // Clean up session
      this.sessionManager.removeSession(session.id);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger('error', 'Error processing session', {
        sessionId: session.id,
        error: err.message,
      });
      session.markError();
      this.emit('vcon:error', err, session);
    }
  }

  /**
   * Wrap a transport to capture MCP messages
   */
  wrapTransport(transport: Transport, sessionId?: string): InterceptingTransport {
    const wrapped = wrapTransport(transport);

    // Handle outgoing messages (server -> client)
    wrapped.on('outgoing', (parsed: ParsedMessage) => {
      this.sessionManager.addMessage('response', parsed.data, {
        sessionId,
        method: parsed.method,
        requestId: parsed.requestId,
      });
    });

    // Handle incoming messages (client -> server)
    wrapped.on('incoming', (parsed: ParsedMessage) => {
      const direction = parsed.direction === 'notification' ? 'notification' : 'request';
      this.sessionManager.addMessage(direction, parsed.data, {
        sessionId,
        method: parsed.method,
        requestId: parsed.requestId,
      });
    });

    this.wrappedTransports.add(wrapped);
    return wrapped;
  }

  /**
   * Get the session manager for direct access
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Get the vCon builder for direct access
   */
  getVconBuilder(): VconBuilder {
    return this.vconBuilder;
  }

  /**
   * Get the conserver client for direct access
   */
  getConserverClient(): ConserverClient {
    return this.conserverClient;
  }

  /**
   * Manually end a session
   */
  endSession(sessionId?: string): void {
    this.sessionManager.endSession(sessionId);
  }

  /**
   * End all active sessions
   */
  endAllSessions(): void {
    this.sessionManager.endAllSessions();
  }

  /**
   * Get the current configuration
   */
  getConfig(): ProxyConfig {
    return { ...this.config };
  }

  /**
   * Shut down the proxy
   */
  async shutdown(): Promise<void> {
    this.logger('info', 'Shutting down vCon MCP Proxy');

    // End all active sessions - this triggers session:end events
    // which will process each session via the event handler
    const sessions = this.sessionManager.endAllSessions();

    // Wait a tick to allow async event handlers to start
    if (sessions.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Clean up
    this.sessionManager.dispose();
    this.wrappedTransports.clear();
    this.removeAllListeners();

    this.logger('info', 'vCon MCP Proxy shut down complete');
  }

  /**
   * Type-safe event emitter methods
   */
  override on<K extends keyof VconMcpProxyEvents>(
    event: K,
    listener: VconMcpProxyEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override once<K extends keyof VconMcpProxyEvents>(
    event: K,
    listener: VconMcpProxyEvents[K]
  ): this {
    return super.once(event, listener);
  }

  override emit<K extends keyof VconMcpProxyEvents>(
    event: K,
    ...args: Parameters<VconMcpProxyEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  override off<K extends keyof VconMcpProxyEvents>(
    event: K,
    listener: VconMcpProxyEvents[K]
  ): this {
    return super.off(event, listener);
  }
}

// Re-export config types
export { parseConfig, defaultLogger } from './config.js';
export type {
  ProxyConfig,
  ProxyConfigInput,
  ConserverConfig,
  SessionConfig,
  VconConfig,
} from './config.js';
