/**
 * Tests for session management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session, SessionManager } from '../src/session/index.js';
import type { SessionConfig } from '../src/proxy/config.js';

const defaultConfig: SessionConfig = {
  timeoutMs: 5000,
  maxMessages: 1000,
  captureResources: true,
  capturePrompts: true,
  maxInlineContentSize: 100000,
};

describe('Session', () => {
  let session: Session;

  beforeEach(() => {
    session = new Session(defaultConfig);
  });

  afterEach(() => {
    session.dispose();
  });

  describe('constructor', () => {
    it('should create a session with default values', () => {
      expect(session.id).toBeDefined();
      expect(session.uuid).toBeDefined();
      expect(session.startedAt).toBeInstanceOf(Date);
      expect(session.state).toBe('active');
      expect(session.messages).toHaveLength(0);
    });

    it('should create a session with custom ID', () => {
      const customSession = new Session(defaultConfig, { id: 'custom-id' });
      expect(customSession.id).toBe('custom-id');
      customSession.dispose();
    });

    it('should set client and server party info', () => {
      const customSession = new Session(defaultConfig, {
        clientInfo: { name: 'Test Client', version: '1.0' },
        serverInfo: { name: 'Test Server', version: '2.0' },
      });
      expect(customSession.clientParty.meta).toEqual({ name: 'Test Client', version: '1.0' });
      expect(customSession.serverParty.meta).toEqual({ name: 'Test Server', version: '2.0' });
      customSession.dispose();
    });
  });

  describe('addMessage', () => {
    it('should add a request message', () => {
      const content = { jsonrpc: '2.0', id: 1, method: 'test', params: {} };
      const msg = session.addMessage('request', content);

      expect(msg).not.toBeNull();
      expect(msg?.direction).toBe('request');
      expect(msg?.method).toBe('test');
      expect(msg?.requestId).toBe(1);
      expect(session.messages).toHaveLength(1);
    });

    it('should add a response message', () => {
      const content = { jsonrpc: '2.0', id: 1, result: { data: 'test' } };
      const msg = session.addMessage('response', content);

      expect(msg).not.toBeNull();
      expect(msg?.direction).toBe('response');
      expect(msg?.requestId).toBe(1);
    });

    it('should add a notification message', () => {
      const content = { jsonrpc: '2.0', method: 'notifications/message', params: {} };
      const msg = session.addMessage('notification', content);

      expect(msg).not.toBeNull();
      expect(msg?.direction).toBe('notification');
      expect(msg?.method).toBe('notifications/message');
      expect(msg?.requestId).toBeUndefined();
    });

    it('should not add messages when session is finalized', () => {
      session.finalize();
      const msg = session.addMessage('request', { method: 'test' });
      expect(msg).toBeNull();
    });

    it('should respect maxMessages limit', () => {
      const smallConfig: SessionConfig = { ...defaultConfig, maxMessages: 3 };
      const limitedSession = new Session(smallConfig);

      limitedSession.addMessage('request', { id: 1 });
      limitedSession.addMessage('request', { id: 2 });
      limitedSession.addMessage('request', { id: 3 });
      const fourth = limitedSession.addMessage('request', { id: 4 });

      expect(limitedSession.messages).toHaveLength(3);
      expect(fourth).toBeNull();
      limitedSession.dispose();
    });

    it('should update client party info from initialize request', () => {
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: {
            name: 'Claude Desktop',
            version: '1.0.0',
          },
        },
      };

      session.addMessage('request', initRequest);
      expect(session.clientParty.name).toBe('Claude Desktop');
      expect(session.clientParty.meta?.version).toBe('1.0.0');
    });

    it('should update server party info from initialize response', () => {
      const initResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          serverInfo: {
            name: 'Test MCP Server',
            version: '2.0.0',
          },
        },
      };

      session.addMessage('response', initResponse, { method: 'initialize' });
      expect(session.serverParty.name).toBe('Test MCP Server');
      expect(session.serverParty.meta?.version).toBe('2.0.0');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      // Add various message types
      session.addMessage('request', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'test' } });
      session.addMessage('response', { jsonrpc: '2.0', id: 1, result: {} });
      session.addMessage('request', { jsonrpc: '2.0', id: 2, method: 'resources/read', params: {} });
      session.addMessage('response', { jsonrpc: '2.0', id: 2, error: { code: -1, message: 'Error' } });

      const stats = session.getStats();

      expect(stats.messageCount).toBe(4);
      expect(stats.toolCalls).toBe(1);
      expect(stats.resourceReads).toBe(1);
      expect(stats.errors).toBe(1);
      expect(stats.totalBytes).toBeGreaterThan(0);
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('finalize', () => {
    it('should change state to finalizing', () => {
      session.finalize();
      expect(session.state).toBe('finalizing');
      expect(session.endedAt).toBeInstanceOf(Date);
    });

    it('should not finalize an already finalized session', () => {
      session.finalize();
      const endedAt = session.endedAt;
      session.finalize();
      expect(session.endedAt).toBe(endedAt);
    });
  });

  describe('getDurationMs', () => {
    it('should return duration in milliseconds', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const duration = session.getDurationMs();
      expect(duration).toBeGreaterThanOrEqual(50);
    });
  });
});

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(defaultConfig);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('getOrCreateSession', () => {
    it('should create a new session', () => {
      const session = manager.getOrCreateSession('test-1');
      expect(session).toBeDefined();
      expect(session.id).toBe('test-1');
    });

    it('should return existing session', () => {
      const session1 = manager.getOrCreateSession('test-1');
      const session2 = manager.getOrCreateSession('test-1');
      expect(session1).toBe(session2);
    });

    it('should create default session when no ID provided', () => {
      const session = manager.getOrCreateSession();
      expect(session.id).toBe('default');
    });
  });

  describe('addMessage', () => {
    it('should add message to correct session', () => {
      manager.addMessage('request', { method: 'test' }, { sessionId: 'session-1' });
      const session = manager.getSession('session-1');
      expect(session?.messages).toHaveLength(1);
    });

    it('should emit session:message event', () => {
      const listener = vi.fn();
      manager.on('session:message', listener);

      manager.addMessage('request', { method: 'test' });

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('endSession', () => {
    it('should finalize the session', () => {
      manager.getOrCreateSession('test-1');
      const session = manager.endSession('test-1');

      expect(session?.state).toBe('finalizing');
    });

    it('should emit session:end event', () => {
      const listener = vi.fn();
      manager.on('session:end', listener);

      manager.getOrCreateSession('test-1');
      manager.endSession('test-1');

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('getActiveSessions', () => {
    it('should return only active sessions', () => {
      manager.getOrCreateSession('active-1');
      manager.getOrCreateSession('active-2');
      manager.getOrCreateSession('ended-1');
      manager.endSession('ended-1');

      const active = manager.getActiveSessions();
      expect(active).toHaveLength(2);
    });
  });

  describe('endAllSessions', () => {
    it('should end all active sessions', () => {
      manager.getOrCreateSession('s1');
      manager.getOrCreateSession('s2');
      manager.getOrCreateSession('s3');

      const ended = manager.endAllSessions();

      expect(ended).toHaveLength(3);
      expect(manager.getActiveSessions()).toHaveLength(0);
    });
  });

  describe('session timeout', () => {
    it('should emit timeout event when session times out', async () => {
      const shortConfig: SessionConfig = { ...defaultConfig, timeoutMs: 100 };
      const shortManager = new SessionManager(shortConfig);
      const timeoutListener = vi.fn();
      const endListener = vi.fn();

      shortManager.on('session:timeout', timeoutListener);
      shortManager.on('session:end', endListener);

      shortManager.getOrCreateSession('timeout-test');

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(timeoutListener).toHaveBeenCalledOnce();
      expect(endListener).toHaveBeenCalledOnce();

      shortManager.dispose();
    });
  });
});
