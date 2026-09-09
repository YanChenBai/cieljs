import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';

import type { TraceEntry, TraceEvent } from '../protocol/index.ts';

/** 每个原始事件对应一个不可变步骤，sequence 同时用于分页与客户端去重。 */
export function createTraceStep(
  trace: TraceEvent,
  tools?: Array<Omit<Agent['state']['tools'][number], 'execute'>>,
  model?: Agent['state']['model'],
): TraceEntry {
  const step: TraceEntry = {
    id: 'step:' + trace.sequence,
    sequence: trace.sequence,
    sessionId: trace.sessionId,
    runId: trace.runId,
    parentRunId: trace.parentRunId,
    turnId: trace.turnId,
    messageId: trace.messageId,
    toolCallId: trace.toolCallId,
    kind: eventKind(trace.event),
    name: trace.event.type,
    status: 'completed',
    startedAt: trace.timestamp,
    endedAt: trace.timestamp,
    raw: { id: trace.id, preview: trace.event.type },
    revision: trace.sequence,
  };
  // 步骤表示事件已经发生；运行中状态由可变的消息/工具摘要记录维护。
  if (trace.event.type === 'tool_execution_end' && trace.event.isError) step.status = 'error';
  attachContentReferences(step, trace);
  attachDisplayMetadata(step, trace.event, tools, model);
  return step;
}

function eventKind(event: AgentEvent): TraceEntry['kind'] {
  if (event.type.startsWith('tool_')) return 'tool';
  if (event.type.startsWith('message_')) return 'message';
  return 'event';
}

function attachContentReferences(step: TraceEntry, trace: TraceEvent) {
  // 引用指向事件快照中的字段，避免在步骤中再次复制图片和完整消息。
  const outputKey = ['message', 'result', 'partialResult', 'messages'].find(
    key => key in trace.event,
  );
  if (outputKey) step.output = { id: trace.id, path: ['event', outputKey], preview: '完整内容' };
  if ('args' in trace.event)
    step.input = { id: trace.id, path: ['event', 'args'], preview: '参数' };
}

function attachDisplayMetadata(
  step: TraceEntry,
  event: AgentEvent,
  tools?: Array<Omit<Agent['state']['tools'][number], 'execute'>>,
  model?: Agent['state']['model'],
) {
  if ('toolName' in event) {
    const tool = tools?.find(tool => tool.name === event.toolName);
    step.label = tool?.label ?? event.toolName;
    step.description = tool?.description;
  }
  if ('message' in event) {
    step.label = event.message.role;
    if (event.message.role === 'assistant') step.label = 'Ciel';
  }
  if (model) {
    const { id, name, provider } = model;
    step.model = { id, name, provider };
  }
}
