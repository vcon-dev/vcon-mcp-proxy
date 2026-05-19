/**
 * Tests for the main VconMcpProxy class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VconMcpProxy } from '../src/proxy/index.js';
import type { ProxyConfigInput } from '../src/proxy/config.js';

const defaultConfig: ProxyConfigInput = {
  conserver: {
    url: 'http://localhost:8000/api/vcon',
    apiToken: 'test-token',
    ingressList: 'test_ingress',
    retryAttempts: 0, // No retries in tests
  },
  vcon: {
    serverName: 'test-server',
    addAnalysis: true,
  },
  session: {
    timeoutMs: 60000,
  },
  debug: false,
};

describe('VconMcpProxy', () => {
  let adapter: VconMcpProxy;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'OK',
    });
    global.fetch = mockFetch;
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.shutdown();
    }
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create adapter with valid config', () => {
      adapter = new VconMcpProxy(defaultConfig);
      expect(adapter).toBeDefined();
    });

    it('should throw on invalid config', () => {
      expect(() => {
        new VconMcpProxy({
          conserver: { url: 'not-a-url' },
        } as any);
      }).toThrow();
    });

    it('should use default values for optional config', () => {
      adapter = new VconMcpProxy({
        conserver: { url: 'http://localhost:8000/api/vcon' },
      });

      const config = adapter.getConfig();
      expect(config.session.timeoutMs).toBe(300000);
      expect(config.vcon.serverName).toBe('mcp-server');
      expect(config.conserver.ingressList).toBe('mcp_sessions');
    });
  });

  describe('getSessionManager', () => {
    it('should return session manager', () => {
      adapter = new VconMcpProxy(defaultConfig);
      const manager = adapter.getSessionManager();
      expect(manager).toBeDefined();
    });
  });

  describe('getVconBuilder', () => {
    it('should return vCon builder', () => {
      adapter = new VconMcpProxy(defaultConfig);
      const builder = adapter.getVconBuilder();
      expect(builder).toBeDefined();
    });
  });

  describe('getConserverClient', () => {
    it('should return conserver client', () => {
      adapter = new VconMcpProxy(defaultConfig);
      const client = adapter.getConserverClient();
      expect(client).toBeDefined();
    });
  });

  describe('session lifecycle', () => {
    it('should emit session:start when session is created', () => {
      adapter = new VconMcpProxy(defaultConfig);
      const listener = vi.fn();
      adapter.on('session:start', listener);

      // Trigger session creation via session manager
      adapter.getSessionManager().getOrCreateSession('test-session');

      expect(listener).toHaveBeenCalledOnce();
    });

    it('should process session on end and emit events', async () => {
      adapter = new VconMcpProxy(defaultConfig);

      const sessionEndListener = vi.fn();
      const vconCreatedListener = vi.fn();
      const vconPostedListener = vi.fn();

      adapter.on('session:end', sessionEndListener);
      adapter.on('vcon:created', vconCreatedListener);
      adapter.on('vcon:posted', vconPostedListener);

      // Create session and add messages
      const manager = adapter.getSessionManager();
      manager.addMessage('request', {
        jsonrpc: '2.0',
        id: 1,
        method: 'test',
      });
      manager.addMessage('response', {
        jsonrpc: '2.0',
        id: 1,
        result: {},
      });

      // End session
      adapter.endSession();

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(sessionEndListener).toHaveBeenCalledOnce();
      expect(vconCreatedListener).toHaveBeenCalledOnce();
      expect(vconPostedListener).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle vcon posting even when conserver fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => 'Error',
      });

      adapter = new VconMcpProxy(defaultConfig);

      const postedListener = vi.fn();
      adapter.on('vcon:posted', postedListener);

      const manager = adapter.getSessionManager();
      manager.addMessage('request', { method: 'test' });
      adapter.endSession();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // vcon:posted is still emitted, but with success: false
      expect(postedListener).toHaveBeenCalled();
      const [result] = postedListener.mock.calls[0];
      expect(result.success).toBe(false);
    });
  });

  describe('endAllSessions', () => {
    it('should end all active sessions', async () => {
      adapter = new VconMcpProxy(defaultConfig);
      const manager = adapter.getSessionManager();

      manager.getOrCreateSession('session-1');
      manager.getOrCreateSession('session-2');

      expect(manager.getActiveSessions()).toHaveLength(2);

      adapter.endAllSessions();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(manager.getActiveSessions()).toHaveLength(0);
    });
  });

  describe('shutdown', () => {
    it('should process remaining sessions on shutdown', async () => {
      // Reset the mock for clean count
      mockFetch.mockClear();

      // Create fresh adapter - don't use shared one
      const shutdownAdapter = new VconMcpProxy(defaultConfig);

      const manager = shutdownAdapter.getSessionManager();
      manager.addMessage('request', { method: 'test' }, { sessionId: 's1' });
      manager.addMessage('request', { method: 'test' }, { sessionId: 's2' });

      // Verify 2 sessions are active
      expect(manager.getActiveSessions()).toHaveLength(2);

      await shutdownAdapter.shutdown();
      // Set adapter to null so afterEach doesn't try to shut down again
      adapter = null as any;

      // mockFetch should have been called twice (once per session)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should clean up resources', async () => {
      adapter = new VconMcpProxy(defaultConfig);
      await adapter.shutdown();

      // After shutdown, session manager should be disposed
      expect(adapter.getSessionManager().getAllSessions()).toHaveLength(0);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      adapter = new VconMcpProxy(defaultConfig);
      const config1 = adapter.getConfig();
      const config2 = adapter.getConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('debug logging', () => {
    it('should use custom logger when provided', async () => {
      const customLogger = vi.fn();
      const loggerAdapter = new VconMcpProxy({
        ...defaultConfig,
        logger: customLogger,
      });

      // Logger should have been called during initialization
      expect(customLogger).toHaveBeenCalled();

      // Cleanup
      await loggerAdapter.shutdown();
      adapter = null as any;
    });

    it('should use default logger when debug is true', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const debugAdapter = new VconMcpProxy({
        ...defaultConfig,
        debug: true,
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();

      // Cleanup
      await debugAdapter.shutdown();
      adapter = null as any;
    });
  });
});

describe('Configuration validation', () => {
  it('should accept minimal config', () => {
    const adapter = new VconMcpProxy({
      conserver: { url: 'http://localhost:8000/api/vcon' },
    });
    expect(adapter).toBeDefined();
    adapter.shutdown();
  });

  it('should reject invalid URL', () => {
    expect(() => {
      new VconMcpProxy({
        conserver: { url: 'invalid' },
      } as any);
    }).toThrow();
  });

  it('should apply default values', () => {
    const adapter = new VconMcpProxy({
      conserver: { url: 'http://localhost:8000/api/vcon' },
    });

    const config = adapter.getConfig();

    expect(config.conserver.ingressList).toBe('mcp_sessions');
    expect(config.conserver.timeoutMs).toBe(30000);
    expect(config.conserver.retryAttempts).toBe(3);
    expect(config.session.timeoutMs).toBe(300000);
    expect(config.vcon.addAnalysis).toBe(true);

    adapter.shutdown();
  });
});
