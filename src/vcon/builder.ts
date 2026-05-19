/**
 * vCon Builder
 * Constructs vCon objects from MCP sessions
 */

import type { Session } from '../session/session.js';
import type { VconConfig } from '../proxy/config.js';
import { mapSessionToVcon, type VconData } from './mcp-mapper.js';

/**
 * Try to use vcon-js library if available, otherwise use internal implementation
 */
let vconJsAvailable = false;
let VconClass: any = null;

// Try to import vcon-js (peer dependency) - done lazily to avoid build errors
// Using string variable to prevent TypeScript from resolving the module at compile time
const VCON_JS_MODULE = 'vcon-js';

async function loadVconJs(): Promise<boolean> {
  if (VconClass !== null) {
    return vconJsAvailable;
  }

  try {
    // Dynamic import with variable to avoid compile-time resolution
    const vconJs = await import(/* webpackIgnore: true */ VCON_JS_MODULE);
    VconClass = vconJs.Vcon;
    vconJsAvailable = true;
    return true;
  } catch {
    // vcon-js not available, use internal implementation
    vconJsAvailable = false;
    VconClass = false; // Mark as attempted
    return false;
  }
}

/**
 * vCon Builder class
 */
export class VconBuilder {
  private config: VconConfig;

  constructor(config: VconConfig) {
    this.config = config;
  }

  /**
   * Build a vCon from a session
   */
  build(session: Session): VconData {
    // Map session to vCon data structure
    const vconData = mapSessionToVcon(session, this.config);
    return vconData;
  }

  /**
   * Build a vCon using vcon-js library if available
   * Returns a Vcon instance from vcon-js or the raw data
   */
  async buildWithLibrary(session: Session): Promise<unknown> {
    const vconData = this.build(session);

    await loadVconJs();

    if (vconJsAvailable && VconClass && typeof VconClass === 'function') {
      try {
        // Create vCon using the library
        const vcon = new VconClass(vconData);
        return vcon;
      } catch {
        // Fall back to raw data if library fails
        return vconData;
      }
    }

    return vconData;
  }

  /**
   * Convert vCon data to JSON string
   */
  toJson(vcon: VconData | unknown): string {
    if (vconJsAvailable && typeof vcon === 'object' && vcon !== null) {
      const vconObj = vcon as any;
      if (typeof vconObj.toJson === 'function') {
        return vconObj.toJson();
      }
    }

    return JSON.stringify(vcon);
  }

  /**
   * Check if vcon-js library is available
   */
  static async isVconJsAvailable(): Promise<boolean> {
    await loadVconJs();
    return vconJsAvailable;
  }
}

/**
 * Create a simple vCon builder with default config
 */
export function createBuilder(config?: Partial<VconConfig>): VconBuilder {
  const fullConfig: VconConfig = {
    serverName: config?.serverName || 'mcp-server',
    serverVersion: config?.serverVersion,
    addAnalysis: config?.addAnalysis ?? true,
    tags: config?.tags || {},
    analysisVendor: config?.analysisVendor || 'vcon-mcp-proxy',
  };

  return new VconBuilder(fullConfig);
}
