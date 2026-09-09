import type { Agent, AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';

export type { AgentEvent, AgentMessage };

export interface RuntimeMetadata {
  tools?: Array<Omit<Agent['state']['tools'][number], 'execute'>>;
  model?: Agent['state']['model'];
  parentRunId?: string;
}

export interface RuntimeRecord {
  version: 1;
  id: string;
  sequence: number;
  sessionId: string;
  runId: string;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  parentRunId?: string;
  timestamp: number;
  event: AgentEvent;
  metadata: RuntimeMetadata;
}

/** 订阅只是唤醒信号，消费者应按持久化游标读取，避免断线丢失事件。 */
export interface RuntimeReader {
  read(after?: number, limit?: number): Promise<RuntimeRecord[]>;
  subscribe(listener: () => void): () => void;
}

export interface RuntimeWriter {
  record(sessionId: string, event: AgentEvent, metadata?: RuntimeMetadata): Promise<RuntimeRecord>;
  flush(): Promise<void>;
}
