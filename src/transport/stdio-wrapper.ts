/**
 * STDIO Transport Wrapper
 * Intercepts stdin/stdout to capture MCP messages
 */

import { Transform, type TransformCallback } from 'stream';
import { EventEmitter } from 'events';
import { MessageBuffer, parseMessage, type ParsedMessage } from './message-parser.js';

/**
 * Transform stream that captures and forwards data
 */
class CaptureTransform extends Transform {
  private messageBuffer: MessageBuffer;
  private onMessage: (messages: ParsedMessage[]) => void;

  constructor(onMessage: (messages: ParsedMessage[]) => void) {
    super();
    this.messageBuffer = new MessageBuffer();
    this.onMessage = onMessage;
  }

  override _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    // Extract and emit messages
    const rawMessages = this.messageBuffer.push(chunk);
    if (rawMessages.length > 0) {
      const parsed = rawMessages.map(parseMessage);
      this.onMessage(parsed);
    }

    // Forward the original data unchanged
    callback(null, chunk);
  }

  override _flush(callback: TransformCallback): void {
    callback();
  }
}

/**
 * Events emitted by StdioWrapper
 */
export interface StdioWrapperEvents {
  'client:message': (message: ParsedMessage) => void;
  'server:message': (message: ParsedMessage) => void;
  'error': (error: Error) => void;
  'close': () => void;
}

/**
 * Wrapper for STDIO transport that captures MCP messages
 */
export class StdioWrapper extends EventEmitter {
  private inputTransform: CaptureTransform;
  private outputTransform: CaptureTransform;
  private isConnected: boolean = false;

  constructor() {
    super();

    // Create transform for client -> server (stdin)
    this.inputTransform = new CaptureTransform((messages) => {
      for (const msg of messages) {
        this.emit('client:message', msg);
      }
    });

    // Create transform for server -> client (stdout)
    this.outputTransform = new CaptureTransform((messages) => {
      for (const msg of messages) {
        this.emit('server:message', msg);
      }
    });
  }

  /**
   * Get the transform stream for stdin (client -> server)
   * Pipe process.stdin through this to capture incoming messages
   */
  getInputTransform(): Transform {
    return this.inputTransform;
  }

  /**
   * Get the transform stream for stdout (server -> client)
   * Pipe this to process.stdout to capture outgoing messages
   */
  getOutputTransform(): Transform {
    return this.outputTransform;
  }

  /**
   * Connect the wrapper to stdin/stdout
   * This modifies the global process streams
   */
  connect(): void {
    if (this.isConnected) return;

    // Note: This is a simplified approach
    // In practice, you'd want to create a more sophisticated proxy
    this.isConnected = true;
  }

  /**
   * Disconnect the wrapper
   */
  disconnect(): void {
    this.isConnected = false;
    this.emit('close');
  }

  /**
   * Type-safe event emitter methods
   */
  override on<K extends keyof StdioWrapperEvents>(
    event: K,
    listener: StdioWrapperEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override once<K extends keyof StdioWrapperEvents>(
    event: K,
    listener: StdioWrapperEvents[K]
  ): this {
    return super.once(event, listener);
  }

  override emit<K extends keyof StdioWrapperEvents>(
    event: K,
    ...args: Parameters<StdioWrapperEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Create readable/writable streams that capture messages
 * while proxying between two endpoints
 */
export interface ProxyStreams {
  /** Stream to pipe client input through */
  clientInput: Transform;
  /** Stream to pipe server output through */
  serverOutput: Transform;
  /** Event emitter for captured messages */
  events: StdioWrapper;
}

/**
 * Create proxy streams for capturing MCP traffic
 */
export function createProxyStreams(): ProxyStreams {
  const wrapper = new StdioWrapper();

  return {
    clientInput: wrapper.getInputTransform(),
    serverOutput: wrapper.getOutputTransform(),
    events: wrapper,
  };
}
