/**
 * Tests for conserver client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConserverClient, ConserverError } from '../src/conserver/index.js';
import type { ConserverConfig } from '../src/proxy/config.js';
import type { VconData } from '../src/vcon/index.js';

const defaultConfig: ConserverConfig = {
  url: 'http://localhost:8000/api/vcon',
  apiToken: 'test-token',
  ingressList: 'test_ingress',
  timeoutMs: 5000,
  retryAttempts: 2,
  retryDelayMs: 100,
};

const sampleVcon: VconData = {
  uuid: 'test-uuid-123',
  vcon: '0.4.0',
  created_at: '2025-01-15T10:00:00Z',
  parties: [{ name: 'Test', role: 'user' }],
  dialog: [],
};

describe('ConserverClient', () => {
  let client: ConserverClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    client = new ConserverClient(defaultConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('post', () => {
    it('should successfully post a vCon', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      const result = await client.post(sampleVcon);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.vconUuid).toBe('test-uuid-123');
      expect(result.retryCount).toBe(0);
    });

    it('should send correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      await client.post(sampleVcon);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/vcon',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ingress_list': 'test_ingress',
            'x-conserver-api-token': 'test-token',
          },
        })
      );
    });

    it('should not send auth header when no token', async () => {
      const noAuthClient = new ConserverClient({
        ...defaultConfig,
        apiToken: undefined,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      await noAuthClient.post(sampleVcon);

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers['x-conserver-api-token']).toBeUndefined();
    });

    it('should accept JSON string input', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      const result = await client.post(JSON.stringify(sampleVcon));

      expect(result.success).toBe(true);
      expect(result.vconUuid).toBe('test-uuid-123');
    });

    it('should retry on server error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Error',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => 'OK',
        });

      const result = await client.post(sampleVcon);

      expect(result.success).toBe(true);
      // retryCount is set on success (0 for first successful attempt)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on client error (4xx)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid vCon',
      });

      const result = await client.post(sampleVcon);

      expect(result.success).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle max retries exceeded', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'Unavailable',
      });

      const result = await client.post(sampleVcon);

      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(2); // retryAttempts = 2
      expect(mockFetch).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should handle network errors', async () => {
      // With retries, all attempts fail
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.post(sampleVcon);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Network error');
    });

    it('should handle timeout', async () => {
      const slowClient = new ConserverClient({
        ...defaultConfig,
        timeoutMs: 10,
        retryAttempts: 0,
      });

      mockFetch.mockImplementationOnce(async (_, options) => {
        // Simulate slow response
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (options?.signal?.aborted) {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          throw error;
        }
        return { ok: true, status: 200, text: async () => 'OK' };
      });

      const result = await slowClient.post(sampleVcon);

      expect(result.success).toBe(false);
      expect(result.message).toContain('timed out');
    });
  });

  describe('logging', () => {
    it('should call logger on success', async () => {
      const logger = vi.fn();
      const loggingClient = new ConserverClient(defaultConfig, logger);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      await loggingClient.post(sampleVcon);

      expect(logger).toHaveBeenCalledWith(
        'debug',
        expect.stringContaining('Posting vCon'),
        expect.any(Object)
      );
      expect(logger).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('Successfully posted'),
        expect.any(Object)
      );
    });

    it('should call logger on error', async () => {
      const logger = vi.fn();
      const loggingClient = new ConserverClient(
        { ...defaultConfig, retryAttempts: 0 },
        logger
      );

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Error',
      });

      await loggingClient.post(sampleVcon);

      expect(logger).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Client error'),
        expect.any(Object)
      );
    });
  });
});

describe('ConserverError', () => {
  it('should create error with status code', () => {
    const error = new ConserverError('Test error', 500, 'Response body');

    expect(error.message).toBe('Test error');
    expect(error.statusCode).toBe(500);
    expect(error.responseBody).toBe('Response body');
    expect(error.name).toBe('ConserverError');
  });

  it('should create error without status code', () => {
    const error = new ConserverError('Network error');

    expect(error.message).toBe('Network error');
    expect(error.statusCode).toBeUndefined();
    expect(error.responseBody).toBeUndefined();
  });
});
