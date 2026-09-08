import type { Agent } from '@earendil-works/pi-agent-core';

import type { TraceEntry, TraceEvent } from '../protocol/index.ts';

/** 原始事件只投影成内容引用；完整输入输出留在快照中按需读取。 */
export function createTraceStep(
  trace: TraceEvent,
  tools?: Agent['state']['tools'],
  model?: Agent['state']['model'],
): TraceEntry {
  const { event } = trace;
  const step: TraceEntry = {
    id: `step:${trace.sequence}`,
    sequence: trace.sequence,
    sessionId: trace.sessionId,
    runId: trace.runId,
    turnId: trace.turnId,
    messageId: trace.messageId,
    toolCallId: trace.toolCallId,
    kind: event.type.startsWith('tool_')
      ? 'tool'
      : event.type.startsWith('message_')
        ? 'message'
        : 'event',
    name: event.type,
    status: event.type === 'tool_execution_end' && event.isError ? 'error' : 'completed',
    startedAt: trace.timestamp,
    endedAt: trace.timestamp,
    raw: { id: trace.id, preview: event.type },
    revision: trace.sequence,
  };
  const outputKey = ['message', 'result', 'partialResult', 'messages'].find(key => key in event);
  if (outputKey) step.output = { id: trace.id, path: ['event', outputKey], preview: '完整内容' };
  if ('args' in event) step.input = { id: trace.id, path: ['event', 'args'], preview: '参数' };
  if ('toolName' in event) {
    const tool = tools?.find(tool => tool.name === event.toolName);
    step.label = tool?.label ?? event.toolName;
    step.description = tool?.description;
  }
  if ('message' in event)
    step.label = event.message.role === 'assistant' ? 'Ciel' : event.message.role;
  if (model) step.model = { id: model.id, name: model.name, provider: model.provider };
  return step;
}
