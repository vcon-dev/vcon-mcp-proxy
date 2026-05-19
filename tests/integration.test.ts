/**
 * Integration tests for vCon MCP Proxy
 * Tests the complete flow from message capture to vCon posting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VconMcpProxy } from '../src/proxy/index.js';
import { SessionManager } from '../src/session/index.js';
import { VconBuilder } from '../src/vcon/index.js';
import type { VconData } from '../src/vcon/index.js';

describe('Integration: Full MCP Session Flow', () => {
  let adapter: VconMcpProxy;
  let mockFetch: ReturnType<typeof vi.fn>;
  let postedVcons: VconData[];

  beforeEach(() => {
    postedVcons = [];
    mockFetch = vi.fn().mockImplementation(async (url, options) => {
      const body = JSON.parse(options.body);
      postedVcons.push(body);
      return {
        ok: true,
        status: 200,
        text: async () => 'OK',
      };
    });
    global.fetch = mockFetch;

    adapter = new VconMcpProxy({
      conserver: {
        url: 'http://localhost:8000/api/vcon',
        apiToken: 'test-token',
        ingressList: 'test_sessions',
      },
      vcon: {
        serverName: 'integration-test-server',
        serverVersion: '1.0.0',
        addAnalysis: true,
        tags: { test: 'integration' },
      },
      session: {
        timeoutMs: 60000,
      },
    });
  });

  afterEach(async () => {
    await adapter.shutdown();
    vi.restoreAllMocks();
  });

  it('should capture a complete MCP session and create valid vCon', async () => {
    const manager = adapter.getSessionManager();

    // Simulate MCP initialize handshake
    manager.addMessage('request', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: {
          name: 'Claude Desktop',
          version: '1.5.0',
        },
        capabilities: {
          tools: {},
        },
      },
    });

    manager.addMessage('response', {
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'Integration Test Server',
          version: '1.0.0',
        },
        capabilities: {
          tools: {},
        },
      },
    });

    // Simulate initialized notification
    manager.addMessage('notification', {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    // Simulate tools/list
    manager.addMessage('request', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    manager.addMessage('response', {
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [
          {
            name: 'search_files',
            description: 'Search for files',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
            },
          },
        ],
      },
    });

    // Simulate tools/call
    manager.addMessage('request', {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'search_files',
        arguments: { query: 'test' },
      },
    });

    manager.addMessage('response', {
      jsonrpc: '2.0',
      id: 3,
      result: {
        content: [
          {
            type: 'text',
            text: 'Found 3 files matching "test"',
          },
        ],
      },
    });

    // End session
    adapter.endSession();

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify vCon was posted
    expect(postedVcons).toHaveLength(1);
    const vcon = postedVcons[0];

    // Verify vCon structure
    expect(vcon.vcon).toBe('0.4.0');
    expect(vcon.uuid).toBeDefined();
    expect(vcon.created_at).toBeDefined();

    // Verify parties
    expect(vcon.parties).toHaveLength(2);
    expect(vcon.parties[0].name).toBe('Claude Desktop');
    expect(vcon.parties[0].role).toBe('user');
    expect(vcon.parties[1].name).toBe('Integration Test Server');
    expect(vcon.parties[1].role).toBe('agent');

    // Verify dialog
    expect(vcon.dialog).toHaveLength(7); // All messages
    expect(vcon.dialog[0].meta?.mcp_method).toBe('initialize');
    // Index 3 is tools/list request (requests have method, responses don't)
    expect(vcon.dialog[3].meta?.mcp_method).toBe('tools/list');

    // Verify analysis
    expect(vcon.analysis).toHaveLength(1);
    const analysisBody = JSON.parse(vcon.analysis![0].body);
    expect(analysisBody.tool_calls).toBe(1);
    expect(analysisBody.message_count).toBe(7);

    // Verify tags attachment (vCon core-02: tags live in attachments[], not top-level)
    const tagsAttachment = vcon.attachments?.find((a) => a.purpose === 'tags');
    expect(tagsAttachment).toBeDefined();
    expect(tagsAttachment!.party).toBe(0);
    expect(tagsAttachment!.dialog).toBe(0);
    const tags = JSON.parse(tagsAttachment!.body) as string[];
    expect(tags).toContain('server_name:integration-test-server');
    expect(tags).toContain('test:integration');
    expect(tags).toContain('tools_used:search_files');
  });

  it('should handle multiple concurrent sessions', async () => {
    const manager = adapter.getSessionManager();

    // Start two sessions
    manager.addMessage('request', { method: 'test', id: 1 }, { sessionId: 'session-a' });
    manager.addMessage('response', { result: {}, id: 1 }, { sessionId: 'session-a' });

    manager.addMessage('request', { method: 'other', id: 1 }, { sessionId: 'session-b' });
    manager.addMessage('response', { result: {}, id: 1 }, { sessionId: 'session-b' });

    // End both sessions
    adapter.endSession('session-a');
    adapter.endSession('session-b');

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should have posted 2 vCons
    expect(postedVcons).toHaveLength(2);

    // They should have different UUIDs
    const uuids = postedVcons.map((v) => v.uuid);
    expect(uuids[0]).not.toBe(uuids[1]);
  });

  it('should handle error responses correctly', async () => {
    const manager = adapter.getSessionManager();

    manager.addMessage('request', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'failing_tool' },
    });

    manager.addMessage('response', {
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32000,
        message: 'Tool execution failed',
        data: { reason: 'timeout' },
      },
    });

    adapter.endSession();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(postedVcons).toHaveLength(1);
    const vcon = postedVcons[0];

    const analysisBody = JSON.parse(vcon.analysis![0].body);
    expect(analysisBody.errors).toBe(1);
  });

  it('should track resource reads', async () => {
    const manager = adapter.getSessionManager();

    manager.addMessage('request', {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'file:///test.txt' },
    });

    manager.addMessage('response', {
      jsonrpc: '2.0',
      id: 1,
      result: {
        contents: [{ uri: 'file:///test.txt', text: 'content' }],
      },
    });

    manager.addMessage('request', {
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/read',
      params: { uri: 'db://users/1' },
    });

    manager.addMessage('response', {
      jsonrpc: '2.0',
      id: 2,
      result: {
        contents: [{ uri: 'db://users/1', text: '{}' }],
      },
    });

    adapter.endSession();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const vcon = postedVcons[0];
    const tags = JSON.parse(
      vcon.attachments!.find((a) => a.purpose === 'tags')!.body
    ) as string[];
    expect(tags).toContain('resource_count:2');
    expect(tags.some((t) => t.startsWith('resources_accessed:') && t.includes('file:///test.txt'))).toBe(true);
  });

  it('should include correct timestamps', async () => {
    const beforeTime = new Date();

    const manager = adapter.getSessionManager();
    manager.addMessage('request', { method: 'test' });

    await new Promise((resolve) => setTimeout(resolve, 50));

    manager.addMessage('response', { result: {} });
    adapter.endSession();

    await new Promise((resolve) => setTimeout(resolve, 200));

    const afterTime = new Date();
    const vcon = postedVcons[0];

    const createdAt = new Date(vcon.created_at);
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    expect(createdAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());

    // Dialog timestamps should be ordered
    const dialogTimes = vcon.dialog.map((d) => new Date(d.start).getTime());
    expect(dialogTimes[1]).toBeGreaterThanOrEqual(dialogTimes[0]);
  });
});

describe('Integration: Component Composition', () => {
  it('should allow using components independently', () => {
    // Session manager standalone
    const sessionManager = new SessionManager({
      timeoutMs: 60000,
      maxMessages: 1000,
      captureResources: true,
      capturePrompts: true,
      maxInlineContentSize: 100000,
    });

    const session = sessionManager.getOrCreateSession('standalone');
    sessionManager.addMessage('request', { method: 'test' }, { sessionId: 'standalone' });

    expect(session.messages).toHaveLength(1);

    // VconBuilder standalone
    const builder = new VconBuilder({
      serverName: 'standalone-test',
      addAnalysis: true,
      tags: {},
      analysisVendor: 'test',
    });

    const vcon = builder.build(session);
    expect(vcon.uuid).toBe(session.uuid);
    expect(vcon.dialog).toHaveLength(1);

    sessionManager.dispose();
  });
});
