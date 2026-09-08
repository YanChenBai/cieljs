import { describe, expect, it } from 'vite-plus/test';

import { createCandidateSources, createRoomSources, createSystemPrompt } from './prompts.ts';

describe('直播来源', () => {
  it('房间 Session 同时包含房间和主播来源', () => {
    expect(
      createRoomSources({
        roomId: 100,
        streamerUid: 200,
        streamerName: '主播 名',
        title: '测试',
        description: '',
        parentAreaName: '娱乐',
        areaName: '聊天',
        live: true,
      }),
    ).toEqual([
      'bilibili:room:100',
      'bilibili:streamer:200',
      'bilibili:streamer-name:%E4%B8%BB%E6%92%AD%20%E5%90%8D',
    ]);
  });

  it('探索来源只标识分区，不随候选数量膨胀', () => {
    const sources = createCandidateSources(1, [
      {
        roomId: 100,
        streamerUid: 200,
        streamerName: '测试主播',
        title: '测试',
        areaName: '聊天',
      },
    ]);

    expect(sources).toEqual(['bilibili:area:1']);
  });
});

describe('观看模式提示词', () => {
  it('单推持续互动，不要求评分 JSON', () => {
    const prompt = createSystemPrompt({ type: 'follow', roomId: 1 });
    expect(prompt).toContain('不需要评分');
    expect(prompt).not.toContain('"score":');
    expect(prompt).toContain('Memory / Session');
    expect(prompt).toContain('MCP');
  });
  it('大量探索候选不会突破来源上限', () => {
    const candidates = Array.from({ length: 100 }, (_, index) => ({
      roomId: index + 1,
      streamerUid: index + 1000,
      streamerName: `主播${index}`,
      title: '聊天',
      areaName: '日常',
    }));
    expect(createCandidateSources(1, candidates)).toEqual(['bilibili:area:1']);
  });
});
