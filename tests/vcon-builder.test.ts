/**
 * Tests for vCon builder
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from '../src/session/index.js';
import {
  VconBuilder,
  mapSessionToVcon,
  mapParty,
  mapMessageToDialog,
  createSessionAnalysis,
  createTagsAttachment,
  extractToolNames,
  extractResourceUris,
} from '../src/vcon/index.js';
import type { SessionConfig } from '../src/proxy/config.js';
import type { VconConfig } from '../src/proxy/config.js';
import type { CapturedMessage } from '../src/session/index.js';

const defaultSessionConfig: SessionConfig = {
  timeoutMs: 300000,
  maxMessages: 1000,
  captureResources: true,
  capturePrompts: true,
  maxInlineContentSize: 100000,
};

const defaultVconConfig: VconConfig = {
  serverName: 'test-server',
  serverVersion: '1.0.0',
  addAnalysis: true,
  tags: { environment: 'test' },
  analysisVendor: 'test-vendor',
};

describe('VconBuilder', () => {
  let session: Session;
  let builder: VconBuilder;

  beforeEach(() => {
    session = new Session(defaultSessionConfig, {
      clientInfo: { name: 'Test Client', version: '1.0' },
      serverInfo: { name: 'Test Server', version: '2.0' },
    });
    builder = new VconBuilder(defaultVconConfig);
  });

  afterEach(() => {
    session.dispose();
  });

  describe('build', () => {
    it('should create a valid vCon from a session', () => {
      // Add some messages
      session.addMessage('request', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'Claude' } },
      });
      session.addMessage('response', {
        jsonrpc: '2.0',
        id: 1,
        result: { serverInfo: { name: 'Test' } },
      });

      const vcon = builder.build(session);

      expect(vcon.uuid).toBe(session.uuid);
      expect(vcon.vcon).toBe('0.4.0');
      expect(vcon.created_at).toBeDefined();
      expect(vcon.parties).toHaveLength(2);
      expect(vcon.dialog).toHaveLength(2);
    });

    it('should include analysis when configured', () => {
      session.addMessage('request', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'test' } });
      session.addMessage('response', { jsonrpc: '2.0', id: 1, result: {} });

      const vcon = builder.build(session);

      expect(vcon.analysis).toBeDefined();
      expect(vcon.analysis).toHaveLength(1);
      expect(vcon.analysis![0].vendor).toBe('test-vendor');
      expect(vcon.analysis![0].type).toBe('session_summary');
    });

    it('should not include analysis when disabled', () => {
      const noAnalysisBuilder = new VconBuilder({ ...defaultVconConfig, addAnalysis: false });
      session.addMessage('request', { method: 'test' });

      const vcon = noAnalysisBuilder.build(session);

      expect(vcon.analysis).toBeUndefined();
    });

    it('should include custom tags in the tags attachment', () => {
      session.addMessage('request', { method: 'test' });
      const vcon = builder.build(session);

      const tagsAttachment = vcon.attachments?.find((a) => a.purpose === 'tags');
      expect(tagsAttachment).toBeDefined();
      expect(tagsAttachment!.party).toBe(0);
      expect(tagsAttachment!.dialog).toBe(0);
      expect(tagsAttachment!.encoding).toBe('json');

      const tags = JSON.parse(tagsAttachment!.body) as string[];
      expect(tags).toContain('environment:test');
      expect(tags).toContain('server_name:test-server');
    });
  });

  describe('toJson', () => {
    it('should convert vCon to JSON string', () => {
      session.addMessage('request', { method: 'test' });
      const vcon = builder.build(session);
      const json = builder.toJson(vcon);

      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.uuid).toBe(vcon.uuid);
    });
  });
});

describe('mapParty', () => {
  it('should map client party', () => {
    const party = mapParty({
      name: 'Test Client',
      role: 'client',
      meta: { version: '1.0' },
    });

    expect(party.name).toBe('Test Client');
    expect(party.role).toBe('user');
    expect(party.meta?.version).toBe('1.0');
  });

  it('should map server party', () => {
    const party = mapParty({
      name: 'Test Server',
      role: 'server',
    });

    expect(party.name).toBe('Test Server');
    expect(party.role).toBe('agent');
  });
});

describe('mapMessageToDialog', () => {
  it('should map message to dialog format', () => {
    const message: CapturedMessage = {
      id: 'msg-1',
      timestamp: new Date('2025-01-15T10:00:00Z'),
      direction: 'request',
      method: 'tools/call',
      requestId: 1,
      content: { jsonrpc: '2.0', id: 1, method: 'tools/call' },
      sizeBytes: 100,
    };

    const dialog = mapMessageToDialog(message, 0);

    expect(dialog.type).toBe('text');
    expect(dialog.start).toBe('2025-01-15T10:00:00.000Z');
    expect(dialog.parties).toEqual([0]);
    expect(dialog.originator).toBe(0);
    expect(dialog.mediatype).toBe('application/json');
    expect(dialog.encoding).toBe('none');
    expect(dialog.meta?.mcp_type).toBe('request');
    expect(dialog.meta?.mcp_method).toBe('tools/call');
    expect(dialog.meta?.request_id).toBe(1);
  });

  it('should serialize content to JSON string', () => {
    const message: CapturedMessage = {
      id: 'msg-1',
      timestamp: new Date(),
      direction: 'response',
      method: 'unknown',
      content: { result: { data: 'test' } },
      sizeBytes: 50,
    };

    const dialog = mapMessageToDialog(message, 1);

    expect(dialog.body).toBe(JSON.stringify({ result: { data: 'test' } }));
  });
});

describe('createSessionAnalysis', () => {
  it('should create analysis with correct stats', () => {
    const stats = {
      messageCount: 10,
      totalBytes: 5000,
      durationMs: 60000,
      toolCalls: 5,
      resourceReads: 2,
      promptGets: 1,
      errors: 0,
    };

    const analysis = createSessionAnalysis(stats, defaultVconConfig, 10);

    expect(analysis.type).toBe('session_summary');
    expect(analysis.vendor).toBe('test-vendor');
    expect(analysis.encoding).toBe('json');

    const body = JSON.parse(analysis.body);
    expect(body.message_count).toBe(10);
    expect(body.tool_calls).toBe(5);
    expect(body.duration_ms).toBe(60000);
  });

  it('should include all dialog indices', () => {
    const stats = {
      messageCount: 3,
      totalBytes: 1000,
      durationMs: 5000,
      toolCalls: 1,
      resourceReads: 0,
      promptGets: 0,
      errors: 0,
    };

    const analysis = createSessionAnalysis(stats, defaultVconConfig, 3);

    expect(analysis.dialog).toEqual([0, 1, 2]);
  });
});

describe('extractToolNames', () => {
  it('should extract tool names from messages', () => {
    const messages: CapturedMessage[] = [
      {
        id: '1',
        timestamp: new Date(),
        direction: 'request',
        method: 'tools/call',
        content: { params: { name: 'tool_a' } },
        sizeBytes: 50,
      },
      {
        id: '2',
        timestamp: new Date(),
        direction: 'response',
        method: 'unknown',
        content: { result: {} },
        sizeBytes: 30,
      },
      {
        id: '3',
        timestamp: new Date(),
        direction: 'request',
        method: 'tools/call',
        content: { params: { name: 'tool_b' } },
        sizeBytes: 50,
      },
      {
        id: '4',
        timestamp: new Date(),
        direction: 'request',
        method: 'tools/call',
        content: { params: { name: 'tool_a' } }, // duplicate
        sizeBytes: 50,
      },
    ];

    const toolNames = extractToolNames(messages);

    expect(toolNames).toHaveLength(2);
    expect(toolNames).toContain('tool_a');
    expect(toolNames).toContain('tool_b');
  });
});

describe('extractResourceUris', () => {
  it('should extract resource URIs from messages', () => {
    const messages: CapturedMessage[] = [
      {
        id: '1',
        timestamp: new Date(),
        direction: 'request',
        method: 'resources/read',
        content: { params: { uri: 'file:///path/to/file.txt' } },
        sizeBytes: 50,
      },
      {
        id: '2',
        timestamp: new Date(),
        direction: 'request',
        method: 'resources/read',
        content: { params: { uri: 'db://table/row' } },
        sizeBytes: 50,
      },
    ];

    const uris = extractResourceUris(messages);

    expect(uris).toHaveLength(2);
    expect(uris).toContain('file:///path/to/file.txt');
    expect(uris).toContain('db://table/row');
  });
});

describe('createTagsAttachment', () => {
  it('should build a spec-compliant tags attachment', () => {
    const session = new Session(defaultSessionConfig);
    session.addMessage('request', { method: 'tools/call', params: { name: 'my_tool' } });

    const attachment = createTagsAttachment(session, defaultVconConfig);

    // Spec-required shape (vCon core-02)
    expect(attachment.purpose).toBe('tags');
    expect(attachment.party).toBe(0);
    expect(attachment.dialog).toBe(0);
    expect(attachment.encoding).toBe('json');

    const tags = JSON.parse(attachment.body) as string[];
    expect(tags).toContain('source:mcp-proxy');
    expect(tags).toContain('server_name:test-server');
    expect(tags).toContain('server_version:1.0.0');
    expect(tags).toContain(`session_id:${session.id}`);
    expect(tags).toContain('environment:test');

    session.dispose();
  });
});

describe('mapSessionToVcon', () => {
  it('should create complete vCon structure', () => {
    const session = new Session(defaultSessionConfig);

    // Simulate a typical MCP session
    session.addMessage('request', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'Claude Desktop' } },
    });
    session.addMessage('response', {
      jsonrpc: '2.0',
      id: 1,
      result: { serverInfo: { name: 'Test Server' } },
    });
    session.addMessage('request', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'test_tool', arguments: {} },
    });
    session.addMessage('response', {
      jsonrpc: '2.0',
      id: 2,
      result: { content: [{ type: 'text', text: 'Result' }] },
    });

    const vcon = mapSessionToVcon(session, defaultVconConfig);

    // Check structure
    expect(vcon.uuid).toBe(session.uuid);
    expect(vcon.vcon).toBe('0.4.0');
    expect(vcon.subject).toContain('test-server');

    // Check parties
    expect(vcon.parties).toHaveLength(2);
    expect(vcon.parties[0].role).toBe('user');
    expect(vcon.parties[1].role).toBe('agent');

    // Check dialog
    expect(vcon.dialog).toHaveLength(4);
    expect(vcon.dialog[0].originator).toBe(0); // request from client
    expect(vcon.dialog[1].originator).toBe(1); // response from server

    // Check analysis
    expect(vcon.analysis).toHaveLength(1);

    // Check tags attachment
    const tags = JSON.parse(
      vcon.attachments!.find((a) => a.purpose === 'tags')!.body
    ) as string[];
    expect(tags).toContain('tool_count:1');

    session.dispose();
  });
});
