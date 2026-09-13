import type { McpTools } from '@cieljs/mcp';
import type { MemoryManagerOptions } from '@cieljs/memory';
import type {
  InvestigateOptions,
  InvestigationResult,
  OpenRuntimeSessionOptions,
  RuntimeSession,
  RuntimeStatus,
} from '@cieljs/runtime';
import type { SessionManagerOptions } from '@cieljs/session';
import type { Storage } from '@cieljs/storage';
import type { VectorService } from '@cieljs/vector';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

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

export interface Ciel extends AsyncDisposable {
  readonly status: RuntimeStatus;
  start(): Promise<void>;
  session(options: OpenRuntimeSessionOptions): Promise<RuntimeSession>;
  investigate(options: InvestigateOptions): Promise<InvestigationResult>;
  close(): Promise<void>;
}

export type CielSession = RuntimeSession;
export type CielStatus = RuntimeStatus;
export type OpenSessionOptions = OpenRuntimeSessionOptions;

export type { InvestigateOptions, InvestigationResult } from '@cieljs/runtime';
export type { SessionSources } from '@cieljs/runtime';
