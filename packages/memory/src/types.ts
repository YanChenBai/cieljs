import type { EmbeddingProvider } from "@cieljs/agent-kit";

export type { EmbeddingOptions, EmbeddingProvider } from "@cieljs/agent-kit";

export type MemoryLayer = "global.long_term" | "space.long_term" | "space.daily";
export type MemoryKind = "event" | "fact" | "preference" | "summary";
export type MemoryStatus = "active" | "archived";

/** @internal */
export type MemoryScope = { type: "global" } | { type: "space"; spaceId: string };
/** @internal */
export type MemoryScopeSelector = MemoryScope[] | "all";

export type MemorySource =
  | { type: "session"; sessionId: string; messageId?: string; fromSeq?: number; toSeq?: number }
  | { type: "event"; eventId: string; uri?: string }
  | { type: "memory"; memoryId: string };

type RememberFields = {
  content: string;
  kind?: MemoryKind;
  occurredAt?: Date;
  expiresAt?: Date | null;
  sources?: MemorySource[];
  metadata?: Record<string, unknown>;
};

export type LongTermRememberInput = RememberFields;
export type DailyRememberInput = RememberFields & {
  /** 省略时按 occurredAt 和存储时区归档。 */
  date?: string;
};

/** @internal */
export type RememberInput = RememberFields & {
  layer: MemoryLayer;
  date?: string;
};

type MemoryEntryFields = {
  id: string;
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
};

export type MemoryEntry = MemoryEntryFields &
  (
    | { layer: "global.long_term"; spaceId: null; date: null }
    | { layer: "space.long_term"; spaceId: string; date: null }
    | { layer: "space.daily"; spaceId: string; date: string }
  );

export interface MemoryAccess {
  includeArchived?: boolean;
  includeExpired?: boolean;
}

/** @internal */
export interface CrossScopeMemoryAccess extends MemoryAccess {
  scopes: MemoryScopeSelector;
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

/** @internal */
export interface CrossScopeMemorySearchOptions extends MemorySearchOptions {
  scopes: MemoryScopeSelector;
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
  /** @internal */
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
