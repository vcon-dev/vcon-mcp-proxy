/**
 * Conserver Client
 * HTTP client for posting vCons to a conserver
 */

import type { ConserverConfig } from '../proxy/config.js';
import type { VconData } from '../vcon/mcp-mapper.js';

/**
 * Result of posting a vCon to the conserver
 */
export interface PostResult {
  success: boolean;
  statusCode?: number;
  message?: string;
  vconUuid: string;
  retryCount: number;
}

/**
 * Error thrown when conserver operations fail
 */
export class ConserverError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'ConserverError';
  }
}

/**
 * Conserver HTTP client
 */
export class ConserverClient {
  private config: ConserverConfig;
  private logger: (level: string, message: string, data?: unknown) => void;

  constructor(
    config: ConserverConfig,
    logger?: (level: string, message: string, data?: unknown) => void
  ) {
    this.config = config;
    this.logger = logger || (() => {});
  }

  /**
   * Post a vCon to the conserver
   */
  async post(vcon: VconData | string): Promise<PostResult> {
    const vconJson = typeof vcon === 'string' ? vcon : JSON.stringify(vcon);
    const vconData = typeof vcon === 'string' ? JSON.parse(vcon) as VconData : vcon;
    const vconUuid = vconData.uuid;

    let lastError: Error | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const result = await this.attemptPost(vconJson, vconUuid);
        return {
          ...result,
          vconUuid,
          retryCount,
        };
      } catch (error) {
        lastError = error as Error;
        retryCount = attempt;

        // Don't retry on client errors (4xx)
        if (error instanceof ConserverError && error.statusCode) {
          if (error.statusCode >= 400 && error.statusCode < 500) {
            this.logger('error', 'Client error posting vCon, not retrying', {
              uuid: vconUuid,
              statusCode: error.statusCode,
              message: error.message,
            });
            break;
          }
        }

        // Wait before retry with exponential backoff
        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          this.logger('warn', 'Retrying vCon post', {
            uuid: vconUuid,
            attempt: attempt + 1,
            maxAttempts: this.config.retryAttempts + 1,
            delayMs: delay,
          });
          await this.sleep(delay);
        }
      }
    }

    // All attempts failed
    return {
      success: false,
      message: lastError?.message || 'Unknown error',
      vconUuid,
      retryCount,
    };
  }

  /**
   * Attempt a single POST request
   */
  private async attemptPost(
    vconJson: string,
    vconUuid: string
  ): Promise<Omit<PostResult, 'vconUuid' | 'retryCount'>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'ingress_list': this.config.ingressList,
      };

      if (this.config.apiToken) {
        headers['x-conserver-api-token'] = this.config.apiToken;
      }

      this.logger('debug', 'Posting vCon to conserver', {
        uuid: vconUuid,
        url: this.config.url,
        ingressList: this.config.ingressList,
      });

      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: vconJson,
        signal: controller.signal,
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new ConserverError(
          `Conserver returned ${response.status}: ${response.statusText}`,
          response.status,
          responseText
        );
      }

      this.logger('info', 'Successfully posted vCon to conserver', {
        uuid: vconUuid,
        statusCode: response.status,
      });

      return {
        success: true,
        statusCode: response.status,
        message: responseText || 'OK',
      };
    } catch (error) {
      if (error instanceof ConserverError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new ConserverError(`Request timed out after ${this.config.timeoutMs}ms`);
        }
        throw new ConserverError(error.message);
      }

      throw new ConserverError('Unknown error');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if the conserver is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        // Try a HEAD request or GET to the base URL
        const baseUrl = new URL(this.config.url);
        const healthUrl = `${baseUrl.origin}/health`;

        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: controller.signal,
        });

        return response.ok;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a conserver client
 */
export function createClient(
  config: ConserverConfig,
  logger?: (level: string, message: string, data?: unknown) => void
): ConserverClient {
  return new ConserverClient(config, logger);
}
