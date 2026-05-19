/**
 * Session Manager - manages multiple MCP sessions
 */

import { EventEmitter } from 'events';
import { Session, type CapturedMessage, type MessageDirection } from './session.js';
import type { SessionConfig } from '../proxy/config.js';

/**
 * Session manager events
 */
export interface SessionManagerEvents {
  'session:start': (session: Session) => void;
  'session:message': (session: Session, message: CapturedMessage) => void;
  'session:end': (session: Session) => void;
  'session:timeout': (session: Session) => void;
  'session:error': (session: Session, error: Error) => void;
}

/**
 * Session Manager - manages multiple concurrent MCP sessions
 */
export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private config: SessionConfig;
  private defaultSessionId: string = 'default';

  constructor(config: SessionConfig) {
    super();
    this.config = config;
  }

  /**
   * Get or create a session by ID
   */
  getOrCreateSession(
    sessionId?: string,
    options?: {
      clientInfo?: Record<string, unknown>;
      serverInfo?: Record<string, unknown>;
    }
  ): Session {
    const id = sessionId || this.defaultSessionId;
    let session = this.sessions.get(id);

    if (!session || session.state !== 'active') {
      session = new Session(this.config, {
        id,
        clientInfo: options?.clientInfo,
        serverInfo: options?.serverInfo,
        onTimeout: () => this.handleSessionTimeout(id),
      });
      this.sessions.set(id, session);
      this.emit('session:start', session);
    }

    return session;
  }

  /**
   * Get an existing session by ID
   */
  getSession(sessionId?: string): Session | undefined {
    return this.sessions.get(sessionId || this.defaultSessionId);
  }

  /**
   * Check if a session exists and is active
   */
  hasActiveSession(sessionId?: string): boolean {
    const session = this.getSession(sessionId);
    return session !== undefined && session.state === 'active';
  }

  /**
   * Add a message to a session
   */
  addMessage(
    direction: MessageDirection,
    content: unknown,
    options?: {
      sessionId?: string;
      method?: string;
      requestId?: string | number;
    }
  ): CapturedMessage | null {
    const session = this.getOrCreateSession(options?.sessionId);
    const message = session.addMessage(direction, content, options);

    if (message) {
      this.emit('session:message', session, message);
    }

    return message;
  }

  /**
   * End a session and trigger finalization
   */
  endSession(sessionId?: string): Session | undefined {
    const id = sessionId || this.defaultSessionId;
    const session = this.sessions.get(id);

    if (session && session.state === 'active') {
      session.finalize();
      this.emit('session:end', session);
    }

    return session;
  }

  /**
   * Handle session timeout
   */
  private handleSessionTimeout(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (session && session.state === 'active') {
      session.finalize();
      this.emit('session:timeout', session);
      this.emit('session:end', session);
    }
  }

  /**
   * Remove a session after it has been processed
   */
  removeSession(sessionId?: string): void {
    const id = sessionId || this.defaultSessionId;
    const session = this.sessions.get(id);

    if (session) {
      session.dispose();
      this.sessions.delete(id);
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.state === 'active'
    );
  }

  /**
   * Get all sessions
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * End all active sessions
   */
  endAllSessions(): Session[] {
    const activeSessions = this.getActiveSessions();
    for (const session of activeSessions) {
      this.endSession(session.id);
    }
    return activeSessions;
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.removeAllListeners();
  }

  /**
   * Type-safe event emitter methods
   */
  override on<K extends keyof SessionManagerEvents>(
    event: K,
    listener: SessionManagerEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override once<K extends keyof SessionManagerEvents>(
    event: K,
    listener: SessionManagerEvents[K]
  ): this {
    return super.once(event, listener);
  }

  override emit<K extends keyof SessionManagerEvents>(
    event: K,
    ...args: Parameters<SessionManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  override off<K extends keyof SessionManagerEvents>(
    event: K,
    listener: SessionManagerEvents[K]
  ): this {
    return super.off(event, listener);
  }
}
