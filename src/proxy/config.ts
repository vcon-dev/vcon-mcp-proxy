/**
 * Configuration types and defaults for vCon MCP Proxy
 */

import { z } from 'zod';

/**
 * Conserver configuration schema
 */
export const ConserverConfigSchema = z.object({
  /** URL of the conserver API endpoint */
  url: z.string().url(),
  /** API token for authentication (optional) */
  apiToken: z.string().optional(),
  /** Ingress list name for the conserver chain */
  ingressList: z.string().default('mcp_sessions'),
  /** Request timeout in milliseconds */
  timeoutMs: z.number().positive().default(30000),
  /** Number of retry attempts */
  retryAttempts: z.number().nonnegative().default(3),
  /** Base delay for exponential backoff in ms */
  retryDelayMs: z.number().positive().default(1000),
});

export type ConserverConfig = z.infer<typeof ConserverConfigSchema>;

/**
 * Session configuration schema
 */
export const SessionConfigSchema = z.object({
  /** Session timeout in milliseconds (auto-finalize after inactivity) */
  timeoutMs: z.number().positive().default(300000), // 5 minutes
  /** Maximum number of messages to buffer per session */
  maxMessages: z.number().positive().default(10000),
  /** Whether to capture resource content */
  captureResources: z.boolean().default(true),
  /** Whether to capture prompt content */
  capturePrompts: z.boolean().default(true),
  /** Maximum size of inline content in bytes (larger content stored as attachment) */
  maxInlineContentSize: z.number().positive().default(100000), // 100KB
});

export type SessionConfig = z.infer<typeof SessionConfigSchema>;

/**
 * vCon generation configuration schema
 */
export const VconConfigSchema = z.object({
  /** Name of the MCP server being wrapped */
  serverName: z.string().default('mcp-server'),
  /** Version of the MCP server */
  serverVersion: z.string().optional(),
  /** Whether to add session analysis to the vCon */
  addAnalysis: z.boolean().default(true),
  /** Additional tags to add to all vCons */
  tags: z.record(z.string()).default({}),
  /** Vendor name for analysis entries */
  analysisVendor: z.string().default('vcon-mcp-proxy'),
});

export type VconConfig = z.infer<typeof VconConfigSchema>;

/**
 * Main proxy configuration schema
 */
export const ProxyConfigSchema = z.object({
  /** Conserver configuration */
  conserver: ConserverConfigSchema,
  /** Session configuration */
  session: SessionConfigSchema.default({}),
  /** vCon generation configuration */
  vcon: VconConfigSchema.default({}),
  /** Enable debug logging */
  debug: z.boolean().default(false),
  /** Custom logger function */
  logger: z.function().optional(),
});

export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;

/**
 * Input type for creating adapter config (all fields optional except conserver.url)
 */
export type ProxyConfigInput = {
  conserver: {
    url: string;
    apiToken?: string;
    ingressList?: string;
    timeoutMs?: number;
    retryAttempts?: number;
    retryDelayMs?: number;
  };
  session?: Partial<SessionConfig>;
  vcon?: Partial<VconConfig>;
  debug?: boolean;
  logger?: (level: string, message: string, data?: any) => void;
};

/**
 * Parse and validate adapter configuration
 */
export function parseConfig(input: ProxyConfigInput): ProxyConfig {
  return ProxyConfigSchema.parse(input);
}

/**
 * Default logger that writes to stderr (for MCP compatibility)
 */
export function defaultLogger(level: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data && { data }),
  };
  console.error(JSON.stringify(logEntry));
}
