import type { TraceEntry } from '../../protocol/index.ts';

/** 历史分页和实时推送可能重叠；按 ID 去重，并保留较新的修订。 */
export function mergeTraceEntries(current: TraceEntry[], incoming: TraceEntry[]) {
  const merged = new Map(current.map(entry => [entry.id, entry]));
  for (const entry of incoming) {
    const previous = merged.get(entry.id);
    if (previous && (previous.revision ?? 0) > (entry.revision ?? 0)) continue;
    merged.set(entry.id, entry);
  }
  return [...merged.values()].sort((a, b) => a.sequence - b.sequence);
}

export function groupTraceSteps(steps: TraceEntry[]) {
  const records = new Map<string, TraceEntry>();
  for (const step of steps) {
    let key = step.id;
    let name = step.name;
    if (step.kind === 'message' && step.messageId) {
      key = step.runId + ':message:' + step.messageId;
      name = 'message';
    } else if (step.kind === 'tool' && step.toolCallId) {
      key = step.runId + ':tool:' + step.toolCallId;
      name = 'tool_execution';
    }
    const previous = records.get(key);
    records.set(key, {
      ...step,
      id: key,
      name,
      revision: step.sequence,
      startedAt: previous?.startedAt ?? step.startedAt,
      input: step.input ?? previous?.input,
      output: step.output ?? previous?.output,
    });
  }
  return [...records.values()];
}
