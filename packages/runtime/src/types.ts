import type { McpTools } from '@cieljs/mcp';
import type { MemoryManagerOptions } from '@cieljs/memory';
import type { SessionManagerOptions } from '@cieljs/session';
import type { Storage } from '@cieljs/storage';
import type { VectorService } from '@cieljs/vector';
import type { Agent, AgentEvent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { SessionSources } from './sources.ts';

export type CielStatus = 'idle' | 'starting' | 'running' | 'closing' | 'closed';

export type SessionStorageOptions = SessionManagerOptions;
export type MemoryStorageOptions = MemoryManagerOptions;
export type InvestigationStorageOptions = SessionManagerOptions;

export interface DefineCielOptions {
  model: Model<Api>;
  /** 请求级 API key，不写入全局环境变量或持久化存储。 */
  apiKey?: string;
  systemPrompt: string;
  storage: Storage;
  session?: Pick<SessionStorageOptions, 'tokenize' | 'onIndexError'>;
  memory?: Pick<MemoryStorageOptions, 'timeZone' | 'tokenize' | 'onIndexError'>;
  vectors?: VectorService;
  tools?: AgentTool[];
  mcp?: McpTools;
  investigation?: {
    systemPrompt?: string;
    tools?: AgentTool[];
  };
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

export interface CielSession extends AsyncDisposable {
  readonly id: string;
  readonly spaceId: string;
  readonly agent: Agent;
  close(): Promise<void>;
}

export interface Ciel extends AsyncDisposable {
  readonly status: CielStatus;
  start(): Promise<void>;
  session(options: OpenSessionOptions): Promise<CielSession>;
  investigate(options: InvestigateOptions): Promise<InvestigationResult>;
  close(): Promise<void>;
}

export type { SessionSources } from './sources.ts';
