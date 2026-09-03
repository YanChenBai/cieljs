export type MemoryScope = { type: "global" } | { type: "space"; spaceId: string };

export type MemoryLayer = "daily" | "long_term";
export type MemoryKind = "event" | "fact" | "preference" | "summary";
export type MemoryStatus = "active" | "archived";

export type MemorySource =
  | { type: "session"; sessionId: string; messageId?: string; fromSeq?: number; toSeq?: number }
  | { type: "event"; eventId: string; uri?: string }
  | { type: "memory"; memoryId: string };

export type RememberInput = {
  scope: MemoryScope;
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

export interface Memory {
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
  /** 必须明确指定可访问范围；空数组不会扩大到全库。 */
  scopes: MemoryScope[];
  includeArchived?: boolean;
  includeExpired?: boolean;
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
  scope: MemoryScope;
  /** 防止并发编辑覆盖；每次修改成功后递增。 */
  expectedRevision: number;
  content?: string;
  kind?: MemoryKind;
  sources?: MemorySource[];
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingOptions {
  purpose: "query" | "document";
  signal?: AbortSignal;
}

/** 与 session 的 Provider 结构兼容，不依赖其存储实现。 */
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  readonly batchSize?: number;
  embedBatch(texts: string[], options: EmbeddingOptions): Promise<number[][]>;
}

export interface MemoryStoreOptions {
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

export interface MemorySearchHit {
  memory: Memory;
  excerpt: string;
  /** RRF 排名分数，不是概率或向量相似度。 */
  score: number;
  matches: SearchMethod[];
}

export interface MemoryContextOptions extends MemoryAccess {
  query?: string;
  date?: string;
  recentDays?: number;
  maxTokens?: number;
  /** 可注入对话模型的 tokenizer；默认采用保守的 UTF-8 字节数上界。 */
  countTokens?: (text: string) => number;
  signal?: AbortSignal;
}

export interface MemoryContext {
  text: string;
  memories: Memory[];
  tokens: number;
}
