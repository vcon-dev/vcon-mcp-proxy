/**
 * Intercepting Transport
 * A transport implementation that wraps another transport to intercept messages
 */

import { EventEmitter } from 'events';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { parseMessage, type ParsedMessage } from './message-parser.js';

/**
 * Events emitted by InterceptingTransport
 */
export interface InterceptingTransportEvents {
  'outgoing': (message: ParsedMessage, raw: JSONRPCMessage) => void;
  'incoming': (message: ParsedMessage, raw: JSONRPCMessage) => void;
}

/**
 * A transport that wraps another transport and intercepts all messages
 */
export class InterceptingTransport extends EventEmitter implements Transport {
  private inner: Transport;
  private started: boolean = false;

  constructor(innerTransport: Transport) {
    super();
    this.inner = innerTransport;
  }

  /**
   * Start the transport
   */
  async start(): Promise<void> {
    if (this.started) return;

    // Wrap the inner transport's onmessage handler
    const originalOnMessage = this.inner.onmessage;
    this.inner.onmessage = (message: JSONRPCMessage) => {
      // Intercept incoming message
      const parsed = parseMessage(message);
      this.emit('incoming', parsed, message);

      // Forward to original handler
      if (this.onmessage) {
        this.onmessage(message);
      }
    };

    // Wrap error and close handlers
    const originalOnError = this.inner.onerror;
    this.inner.onerror = (error: Error) => {
      if (this.onerror) {
        this.onerror(error);
      }
    };

    const originalOnClose = this.inner.onclose;
    this.inner.onclose = () => {
      if (this.onclose) {
        this.onclose();
      }
    };

    await this.inner.start();
    this.started = true;
  }

  /**
   * Send a message through the transport
   */
  async send(message: JSONRPCMessage): Promise<void> {
    // Intercept outgoing message
    const parsed = parseMessage(message);
    this.emit('outgoing', parsed, message);

    // Forward to inner transport
    await this.inner.send(message);
  }

  /**
   * Close the transport
   */
  async close(): Promise<void> {
    await this.inner.close();
    this.started = false;
  }

  // Transport interface properties
  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  /**
   * Type-safe event emitter methods
   */
  override on<K extends keyof InterceptingTransportEvents>(
    event: K,
    listener: InterceptingTransportEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override once<K extends keyof InterceptingTransportEvents>(
    event: K,
    listener: InterceptingTransportEvents[K]
  ): this {
    return super.once(event, listener);
  }

  override emit<K extends keyof InterceptingTransportEvents>(
    event: K,
    ...args: Parameters<InterceptingTransportEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Wrap an existing transport to intercept messages
 */
export function wrapTransport(transport: Transport): InterceptingTransport {
  return new InterceptingTransport(transport);
}
