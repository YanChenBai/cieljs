import type { EmbeddingProvider } from "@cieljs/agent-kit";

export type { EmbeddingOptions, EmbeddingProvider } from "@cieljs/agent-kit";

export type MemoryScope = { type: "global" } | { type: "space"; spaceId: string };

export type MemoryLayer = "daily" | "long_term";
export type MemoryKind = "event" | "fact" | "preference" | "summary";
export type MemoryStatus = "active" | "archived";

export type MemorySource =
  | { type: "session"; sessionId: string; messageId?: string; fromSeq?: number; toSeq?: number }
  | { type: "event"; eventId: string; uri?: string }
  | { type: "memory"; memoryId: string };

export type RememberInput = {
  content: string;
  kind?: MemoryKind;
  occurredAt?: Date;
  expiresAt?: Date | null;
  dedupeKey?: string;
  sources?: MemorySource[];
  metadata?: Record<string, unknown>;
} & (
  | { layer: "daily"; /** 省略时按 occurredAt 和存储时区归档。 */ date?: string }
  | { layer: "long_term"; date?: never }
);

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  layer: MemoryLayer;
  date: string | null;
  kind: MemoryKind;
  content: string;
  status: MemoryStatus;
  revision: number;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  sources: MemorySource[];
  metadata: Record<string, unknown>;
}

export interface MemoryAccess {
  /** 是否包含已归档或已过期的记忆；范围由 Memory 固定。 */
  includeArchived?: boolean;
  includeExpired?: boolean;
}

export interface CrossScopeMemoryAccess extends MemoryAccess {
  /** 明确列出本次允许读取的范围；不会隐式加入 global。 */
  scopes: MemoryScope[];
}

export interface MemoryFilter extends MemoryAccess {
  layer?: MemoryLayer;
  kind?: MemoryKind;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateMemoryInput {
  /** 防止并发编辑覆盖；每次修改成功后递增。 */
  expectedRevision: number;
  content?: string;
  kind?: MemoryKind;
  sources?: MemorySource[];
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface MemoryManagerOptions {
  dataDir: string;
  timeZone?: string;
  embedding?: EmbeddingProvider;
  /** 文档与查询共享分词规则；修改规则后调用 rebuildIndex。 */
  tokenize?: (text: string) => string[];
  onIndexError?: (error: unknown) => void;
}

export type SearchMethod = "fts" | "trigram" | "vector";

export interface MemorySearchOptions extends MemoryFilter {
  signal?: AbortSignal;
  candidateLimit?: number;
  minVectorSimilarity?: number;
}

export interface CrossScopeMemorySearchOptions extends MemorySearchOptions {
  /** 明确列出本次允许搜索的范围；不会隐式加入 global。 */
  scopes: MemoryScope[];
}

export interface MemorySearchHit {
  memory: MemoryEntry;
  excerpt: string;
  /** RRF 排名分数，不是概率或向量相似度。 */
  score: number;
  matches: SearchMethod[];
}

export interface MemoryContextOptions extends MemoryAccess {
  query?: string;
  /** 默认同时注入近期每日记忆与长期记忆。 */
  layers?: MemoryLayer[];
  date?: string;
  recentDays?: number;
  maxTokens?: number;
  /** 可注入对话模型的 tokenizer；默认采用保守的 UTF-8 字节数上界。 */
  countTokens?: (text: string) => number;
  signal?: AbortSignal;
}

export interface MemoryContext {
  text: string;
  memories: MemoryEntry[];
  tokens: number;
}
