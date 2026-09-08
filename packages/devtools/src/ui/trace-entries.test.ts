import { expect, it } from 'vite-plus/test';

import type { TraceEntry } from '../protocol/index.ts';
import { groupTraceSteps, mergeTraceEntries } from './trace-entries.ts';

const entry = (sequence: number, overrides: Partial<TraceEntry> = {}): TraceEntry => ({
  id: String(sequence),
  sequence,
  sessionId: 'test',
  kind: 'event',
  name: 'event',
  status: 'completed',
  startedAt: sequence,
  ...overrides,
});

it('历史页与推送重叠时去重，并保留较新的修订', () => {
  const newest = entry(2, { revision: 8 });
  expect(mergeTraceEntries([newest, entry(3)], [entry(1), entry(2, { revision: 4 })])).toEqual([
    entry(1),
    newest,
    entry(3),
  ]);
});

it('同一次工具调用保留开始时间和输入，不与其他 run 合并', () => {
  const start = entry(1, {
    kind: 'tool',
    runId: 'a',
    toolCallId: 'call',
    input: { id: 'input', preview: '参数' },
  });
  const end = entry(2, {
    kind: 'tool',
    runId: 'a',
    toolCallId: 'call',
    output: { id: 'output', preview: '结果' },
  });
  const other = entry(3, { kind: 'tool', runId: 'b', toolCallId: 'call' });
  const grouped = groupTraceSteps([start, end, other]);
  expect(grouped).toHaveLength(2);
  expect(grouped[0]).toMatchObject({
    startedAt: 1,
    revision: 2,
    input: start.input,
    output: end.output,
  });
});
