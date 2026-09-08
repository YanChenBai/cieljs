import { describe, expect, it } from 'vite-plus/test';

import { parseDecision, RoomDecisionSchema } from './decisions.ts';

describe('parseDecision', () => {
  it('接受代码围栏包裹的合法 JSON', () => {
    const decision = parseDecision(
      '```json\n{"action":"stay","confidence":0.8,"danmakuAction":"defer","evidence":[],"reason":"继续观察","score":60}\n```',
      RoomDecisionSchema,
    );

    expect(decision.score).toBe(60);
  });

  it('拒绝越界评分', () => {
    expect(() =>
      parseDecision(
        '{"action":"stay","confidence":0.8,"danmakuAction":"defer","evidence":[],"reason":"继续观察","score":101}',
        RoomDecisionSchema,
      ),
    ).toThrow('Agent 输出不是有效的决策 JSON');
  });
});

it('接受分析文字后唯一的 JSON 代码块', () => {
  const text =
    '当前空间没有历史记录。\n分析：选择聊天直播。\n```json\n{"action":"stay","confidence":0.8,"danmakuAction":"defer","evidence":[],"reason":"继续观察","score":60}\n```';
  expect(parseDecision(text, RoomDecisionSchema).score).toBe(60);
});
it('拒绝存在多个候选决策的回复', () => {
  expect(() => parseDecision('```json\n{}\n```\n```json\n{}\n```', RoomDecisionSchema)).toThrow(
    '多个决策',
  );
});
