import type { Agent, AgentEvent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { EmbeddingProvider } from "@cieljs/agent-kit";
import type { McpOptions } from "@cieljs/mcp";
import type { MemoryManagerOptions } from "@cieljs/memory";
import type { SessionManagerOptions } from "@cieljs/session";

import type { SessionSources } from "./sources.ts";

export type CielStatus = "idle" | "starting" | "running" | "closing" | "closed";

export type SessionStorageOptions = SessionManagerOptions;
export type MemoryStorageOptions = MemoryManagerOptions;
export type InvestigationStorageOptions = SessionManagerOptions;
export type CielEmbeddingOptions = EmbeddingProvider;

export interface CielMcpOptions extends McpOptions {
  enabled: boolean;
}

export interface DefineCielOptions {
  model: Model<Api>;
  systemPrompt: string;
  session: Omit<SessionStorageOptions, "embedding">;
  memory: Omit<MemoryStorageOptions, "embedding">;
  embedding?: CielEmbeddingOptions;
  tools?: AgentTool[];
  mcp?: CielMcpOptions;
  investigation?: {
    systemPrompt?: string;
    tools?: AgentTool[];
  } & Omit<SessionManagerOptions, "embedding">;
}

export interface OpenSessionOptions {
  /** 允许工具只读检索其他 Space；默认仅当前 Space。 */
  crossSpace?: boolean;
  sessionId?: string;
  spaceId: string;
  sources?: SessionSources;
}

export interface InvestigateOptions extends OpenSessionOptions {
  question: string | AgentMessage[];
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent, context: { tools: AgentTool[]; model: Model<Api> }) => void;
}

export interface InvestigationResult {
  sessionId: string;
  answer: AgentMessage;
  messages: AgentMessage[];
}

export interface CielSession {
  readonly id: string;
  readonly spaceId: string;
  readonly agent: Agent;
  close(): Promise<void>;
}

export interface Ciel {
  readonly status: CielStatus;
  start(): Promise<void>;
  session(options: OpenSessionOptions): Promise<CielSession>;
  investigate(options: InvestigateOptions): Promise<InvestigationResult>;
  close(): Promise<void>;
}

export type { SessionSources } from "./sources.ts";
