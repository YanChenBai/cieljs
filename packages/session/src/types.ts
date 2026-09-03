import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface EmbeddingProvider {
  /**
   * embedding model 标识。
   *
   * 例如：
   *
   * qwen3-embedding-0.6b
   */
  readonly model: string;

  /**
   * 必须和 schema 中 EMBEDDING_DIMENSIONS 一致。
   */
  readonly dimensions: number;

  embed(text: string): Promise<number[]>;
}

export interface SessionContext {
  /**
   * 最近一次累计摘要。
   */
  summary: string | null;

  /**
   * summary 尚未覆盖的原始消息。
   */
  messages: AgentMessage[];
}

export interface AppendCompactionInput {
  /**
   * 累计摘要。
   */
  summary: string;

  /**
   * 此 summary 已覆盖至哪条 Message。
   */
  throughSeq: number;
}

export interface SearchOptions {
  sessionId?: string;

  limit?: number;

  /**
   * Vector cosine similarity threshold。
   */
  minVectorSimilarity?: number;

  ftsLimit?: number;

  trigramLimit?: number;

  vectorLimit?: number;
}

export interface SearchHit {
  chunkId: string;

  sessionId: string;

  messageId: string;

  messageSeq: number;

  content: string;

  /**
   * Hybrid RRF score。
   */
  score: number;

  sources: Array<"fts" | "trigram" | "vector">;
}

export interface RawSearchHit {
  chunkId: string;

  sessionId: string;

  messageId: string;

  messageSeq: number;

  content: string;

  score: number;
}

export interface SessionStoreOptions {
  dataDir: string;

  /**
   * 不提供则只有全文检索。
   */
  embedding?: EmbeddingProvider;

  /**
   * embedding 错误不会影响 Session。
   */
  onIndexError?: (error: unknown) => void;
}
