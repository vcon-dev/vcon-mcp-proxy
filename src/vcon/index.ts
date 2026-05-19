/**
 * vCon builder exports
 */

export { VconBuilder, createBuilder } from './builder.js';

export {
  mapSessionToVcon,
  mapParty,
  mapMessageToDialog,
  createSessionAnalysis,
  createTagsAttachment,
  extractToolNames,
  extractResourceUris,
} from './mcp-mapper.js';

export type {
  VconData,
  VconParty,
  VconDialog,
  VconAnalysis,
  VconAttachment,
} from './mcp-mapper.js';
