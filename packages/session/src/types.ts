import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { EmbeddingProvider } from "@cieljs/agent-kit";

export type { EmbeddingOptions, EmbeddingProvider } from "@cieljs/agent-kit";

export type SearchSource = "fts" | "trigram" | "vector";

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

  sources: Array<SearchSource>;
}

export interface RawSearchHit {
  chunkId: string;

  sessionId: string;

  messageId: string;

  messageSeq: number;

  content: string;

  score: number;
}

export interface SessionManagerOptions {
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

export interface Chunk {
  id: string;
  content: string;
}

export interface GenerateSummaryInput {
  systemPrompt: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface SessionSummarizerOptions {
  /** 在此配置模型、凭据、输出上限及超时，存储层不依赖具体模型 SDK。 */
  generateText: (input: GenerateSummaryInput) => Promise<string>;
  /** 追加领域要求，不替换历史内容的信任边界。 */
  instructions?: string;
}
