import type { Agent, AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';

export type { AgentEvent, AgentMessage };

export interface RuntimeMetadata {
  tools?: Array<Omit<Agent['state']['tools'][number], 'execute'>>;
  model?: Agent['state']['model'];
  parentRunId?: string;
}

/** 会话压缩产生的运行时事件；不属于 Pi Agent 事件，但共用同一条运行时事件流。 */
export interface SessionCompactionEvent {
  type: 'session_compaction';
  summary: string;
  throughSeq: number;
  createdAt: number;
  /**
   * 压缩后的上下文 token 估算（摘要加保留的原文），供 Trace 等消费者立即更新
   * 「当前上下文」；旧记录可能没有这个字段。不含系统提示与工具定义开销。
   */
  contextTokens?: number;
}

export type RuntimeEvent = AgentEvent | SessionCompactionEvent;
export type RuntimeUpdateEvent = Extract<
  AgentEvent,
  { type: 'message_update' | 'tool_execution_update' }
>;

/**
 * 一条已经完成关联的运行时事件。
 *
 * `revision` 是进程内实时事件序号，只用于 live projection；持久化后 RuntimeRecord
 * 会使用 durable sequence 覆盖它。实体 ID 在这里生成，因此 update 不需要经过数据库
 * 也能与 start/end 关联。
 */
export interface RuntimeEventEnvelope {
  version: 1;
  id: string;
  revision: number;
  sessionId: string;
  runId: string;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  toolExecutionId?: string;
  parentRunId?: string;
  timestamp: number;
  event: RuntimeEvent;
  metadata: RuntimeMetadata;
}

/** 一条已落盘的运行时事实。`sequence` 仅属于持久化流水。 */
export interface RuntimeRecord extends RuntimeEventEnvelope {
  sequence: number;
}

/** Durable reader：subscribe 只是唤醒信号，消费者按持久化游标读取。 */
export interface RuntimeReader {
  read(after?: number, limit?: number): Promise<RuntimeRecord[]>;
  subscribe(listener: () => void): () => void;
}

/**
 * Live event bus：publish 负责关联 ID、实时分发，并按实现的持久化策略写入事实流水。
 * update 事件仍会出现在 subscribe 中，但可以完全不进入 durable reader。
 */
export interface RuntimeEventBus {
  publish(
    sessionId: string,
    event: RuntimeEvent,
    metadata?: RuntimeMetadata,
  ): Promise<RuntimeEventEnvelope>;
  subscribe(listener: (event: RuntimeEventEnvelope) => void): () => void;
  flush(): Promise<void>;
}

export function isRuntimeUpdateEvent(event: RuntimeEvent): event is RuntimeUpdateEvent {
  return event.type === 'message_update' || event.type === 'tool_execution_update';
}
