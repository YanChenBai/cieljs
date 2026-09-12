import type { RuntimeRecord } from '@cieljs/agent-kit/protocol';
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import { expect, it } from 'vite-plus/test';

import { TraceUsageTally } from './usage.ts';

type Counts = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
};

/** 夹具与真实消息同形，其余必填字段只求满足类型。 */
function assistant(counts: Counts): AgentMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'xiaomi',
    model: 'mimo-v2.5',
    stopReason: 'stop',
    timestamp: 0,
    usage: { ...counts, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

function record(event: AgentEvent): RuntimeRecord {
  return {
    version: 1,
    id: 'record:1',
    sequence: 1,
    sessionId: 'live',
    runId: 'run:1',
    timestamp: 0,
    event,
    metadata: {},
  };
}

const ended = (message: AgentMessage) => record({ type: 'message_end', message });

it('累计每次请求的用量，并以最近一次请求作为当前上下文', () => {
  const tally = new TraceUsageTally();
  tally.consume(
    ended(assistant({ input: 100, output: 20, cacheRead: 800, cacheWrite: 0, totalTokens: 920 })),
  );
  tally.consume(
    ended(assistant({ input: 50, output: 10, cacheRead: 900, cacheWrite: 5, totalTokens: 965 })),
  );

  expect(tally.snapshot()).toEqual({
    total: { input: 150, output: 30, cacheRead: 1700, cacheWrite: 5, total: 1885 },
    context: { input: 50, output: 10, cacheRead: 900, cacheWrite: 5, total: 965 },
  });
});

it('按 Session 独立统计用量与当前上下文', () => {
  const tally = new TraceUsageTally();
  tally.consume({
    ...ended(assistant({ input: 10, output: 2, cacheRead: 80, cacheWrite: 0, totalTokens: 92 })),
    sessionId: 'first',
    timestamp: 10,
  });
  tally.consume({
    ...ended(assistant({ input: 20, output: 4, cacheRead: 60, cacheWrite: 1, totalTokens: 85 })),
    sessionId: 'second',
    timestamp: 20,
  });

  expect(tally.snapshot('first')).toEqual({
    total: { input: 10, output: 2, cacheRead: 80, cacheWrite: 0, total: 92 },
    context: { input: 10, output: 2, cacheRead: 80, cacheWrite: 0, total: 92 },
  });
  expect(tally.sessions().map(session => session.id)).toEqual(['first', 'second']);
});

it('只认 message_end，流式增量不会重复计入', () => {
  const tally = new TraceUsageTally();
  const message = assistant({ input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 });
  tally.consume(record({ type: 'message_start', message }));
  expect(tally.snapshot().total.total).toBe(0);

  tally.consume(ended(message));
  expect(tally.snapshot().total.total).toBe(12);
});

it('没有总量时按各项相加兜底', () => {
  const tally = new TraceUsageTally();
  tally.consume(
    ended(assistant({ input: 30, output: 5, cacheRead: 60, cacheWrite: 5, totalTokens: 0 })),
  );

  expect(tally.snapshot().total.total).toBe(100);
});

it('零用量与非 assistant 消息不计入，也不顶替当前上下文', () => {
  const tally = new TraceUsageTally();
  tally.consume(
    ended(assistant({ input: 100, output: 20, cacheRead: 800, cacheWrite: 0, totalTokens: 920 })),
  );
  tally.consume(ended({ role: 'user', content: '继续', timestamp: 0 }));
  tally.consume(
    ended(assistant({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 })),
  );

  expect(tally.snapshot().total.total).toBe(920);
  expect(tally.snapshot().context?.total).toBe(920);
});

it('残缺的用量整条丢弃，不污染累计', () => {
  const tally = new TraceUsageTally();
  // 类型上不存在这种消息，但记录来自磁盘，读到的可能是任何东西。
  const broken = {
    ...assistant({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }),
    usage: { input: Number.NaN, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  } as unknown as AgentMessage;
  tally.consume(ended(broken));

  expect(tally.snapshot()).toEqual({
    total: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    context: null,
  });
});
