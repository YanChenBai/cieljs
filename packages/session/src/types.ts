import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface EmbeddingOptions {
  /** 区分检索查询与待索引文档，供模型选择前缀或任务类型。 */
  purpose: "query" | "document";
  signal?: AbortSignal;
}

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
   * 输出向量维数。不同模型和维数的索引相互隔离。
   */
  readonly dimensions: number;

  /** 统一批量接口，返回顺序必须与输入一致；查询也使用单元素数组。 */
  embedBatch(texts: string[], options: EmbeddingOptions): Promise<number[][]>;

  /** 单次索引请求的最大文本数，默认 32。 */
  readonly batchSize?: number;
}

export interface SummarizeInput {
  sessionId: string;
  /** 上次累计摘要；本次应结合新增历史生成完整的新摘要。 */
  summary: string | null;
  messages: AgentMessage[];
  signal?: AbortSignal;
}

export type SessionSummarizer = (input: SummarizeInput) => Promise<string>;

export interface CompactionOptions {
  summarize: SessionSummarizer;
  /** 至少保留最新多少条原始消息，默认 10；切分时保留完整用户轮次。 */
  keepRecentMessages?: number;
  /** 对话模型的上下文窗口大小，单位为 token。 */
  contextWindow: number;
  /** 为后续生成预留的 token，默认 16384，与 Pi 一致。 */
  reserveTokens?: number;
  /** 忽略触发阈值，仍遵守保留数量与轮次边界。 */
  force?: boolean;
  signal?: AbortSignal;
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
  /** 乐观并发检查：摘要所基于的旧边界，首次压缩为 0。 */
  expectedThroughSeq?: number;
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
  signal?: AbortSignal;
  sessionId?: string;

  limit?: number;

  /**
   * 向量余弦相似度阈值。
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
   * 多路检索融合后的排名分数。
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
