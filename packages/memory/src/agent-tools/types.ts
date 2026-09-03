import type { MemoryStore } from "../store.ts";
import type { MemoryScope, MemorySource } from "../types.ts";

export interface CreateMemoryToolsOptions {
  store: MemoryStore;
  scope: MemoryScope;
  includeGlobal?: boolean;
  allowWrite?: boolean;
  searchLimit?: number;
  maxReadChars?: number;
  /** 为工具产生的记忆附加来源，例如当前 session。 */
  sources?: MemorySource[];
}
