/**
 * Tests for transport wrappers
 */

import { describe, it, expect, vi } from 'vitest';
import { MessageBuffer, parseMessage, type ParsedMessage } from '../src/transport/index.js';

describe('parseMessage', () => {
  describe('request detection', () => {
    it('should identify a JSON-RPC request', () => {
      const data = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'test' },
      };

      const result = parseMessage(data);

      expect(result.direction).toBe('request');
      expect(result.method).toBe('tools/call');
      expect(result.requestId).toBe(1);
    });

    it('should handle string request ID', () => {
      const data = {
        jsonrpc: '2.0',
        id: 'abc-123',
        method: 'test',
      };

      const result = parseMessage(data);

      expect(result.direction).toBe('request');
      expect(result.requestId).toBe('abc-123');
    });
  });

  describe('response detection', () => {
    it('should identify a successful response', () => {
      const data = {
        jsonrpc: '2.0',
        id: 1,
        result: { data: 'test' },
      };

      const result = parseMessage(data);

      expect(result.direction).toBe('response');
      expect(result.requestId).toBe(1);
      expect(result.isError).toBeFalsy();
    });

    it('should identify an error response', () => {
      const data = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' },
      };

      const result = parseMessage(data);

      expect(result.direction).toBe('response');
      expect(result.requestId).toBe(1);
      expect(result.isError).toBe(true);
    });
  });

  describe('notification detection', () => {
    it('should identify a notification (method without id)', () => {
      const data = {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'info' },
      };

      const result = parseMessage(data);

      expect(result.direction).toBe('notification');
      expect(result.method).toBe('notifications/message');
      expect(result.requestId).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle non-object data', () => {
      const result = parseMessage('string data');
      expect(result.direction).toBe('notification');
    });

    it('should handle null data', () => {
      const result = parseMessage(null);
      expect(result.direction).toBe('notification');
    });

    it('should handle unknown format', () => {
      const data = { foo: 'bar' };
      const result = parseMessage(data);
      expect(result.direction).toBe('notification');
    });
  });
});

describe('MessageBuffer', () => {
  let buffer: MessageBuffer;

  beforeEach(() => {
    buffer = new MessageBuffer();
  });

  describe('push', () => {
    it('should extract complete JSON messages', () => {
      const message = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test' });
      const messages = buffer.push(message + '\n');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ jsonrpc: '2.0', id: 1, method: 'test' });
    });

    it('should handle multiple messages in one push', () => {
      const msg1 = JSON.stringify({ id: 1, method: 'a' });
      const msg2 = JSON.stringify({ id: 2, method: 'b' });
      const messages = buffer.push(msg1 + '\n' + msg2 + '\n');

      expect(messages).toHaveLength(2);
    });

    it('should buffer incomplete messages', () => {
      const partial = '{"jsonrpc":"2.0","id":';
      const messages = buffer.push(partial);

      expect(messages).toHaveLength(0);
      expect(buffer.hasPending()).toBe(true);
    });

    it('should complete buffered messages', () => {
      buffer.push('{"id":1,');
      const messages = buffer.push('"method":"test"}\n');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ id: 1, method: 'test' });
    });

    it('should handle Buffer input', () => {
      const buf = Buffer.from('{"id":1}\n');
      const messages = buffer.push(buf);

      expect(messages).toHaveLength(1);
    });

    it('should skip invalid JSON lines', () => {
      const messages = buffer.push('not json\n{"id":1}\n');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ id: 1 });
    });

    it('should skip empty lines', () => {
      const messages = buffer.push('\n\n{"id":1}\n\n');

      expect(messages).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should clear the buffer', () => {
      buffer.push('incomplete');
      expect(buffer.hasPending()).toBe(true);

      buffer.clear();

      expect(buffer.hasPending()).toBe(false);
    });
  });

  describe('hasPending', () => {
    it('should return false for empty buffer', () => {
      expect(buffer.hasPending()).toBe(false);
    });

    it('should return true when data is pending', () => {
      buffer.push('partial');
      expect(buffer.hasPending()).toBe(true);
    });

    it('should return false after message extraction', () => {
      buffer.push('{"complete":true}\n');
      expect(buffer.hasPending()).toBe(false);
    });
  });
});
