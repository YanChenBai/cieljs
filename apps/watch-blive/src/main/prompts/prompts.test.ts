import { describe, expect, it } from 'vite-plus/test';

import {
  createCandidateSources,
  createRoomContext,
  createRoomSources,
  createSystemPrompt,
} from '../prompts';

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
  it('视频场景说明进入模型提示词，直播提示词不受影响', () => {
    const prompt = createSystemPrompt({
      type: 'recording',
      roomId: 1,
      source: { type: 'file', path: '/video.mp4' },
      prompt: '这是游戏评测，请关注角色评价。',
    });
    expect(prompt).toContain('这是游戏评测，请关注角色评价。');
    expect(prompt).toContain('视频不一定是直播录播');
    expect(prompt).not.toContain('每轮必须调用且只调用一次 send_danmaku');
  });
  it('单推持续互动，不要求评分 JSON', () => {
    const prompt = createSystemPrompt({ type: 'follow', roomId: 1 });
    expect(prompt).toContain('不需要评分');
    expect(prompt).not.toContain('"score":');
    expect(prompt).toContain('Memory / Session');
    expect(prompt).toContain('MCP');
  });
  it('录播模式只总结分析，不包含弹幕工具规则', () => {
    const prompt = createSystemPrompt({
      type: 'recording',
      roomId: 1,
      source: { type: 'url', url: 'https://example.com/video.mp4' },
    });

    expect(prompt).toContain('# 录播模式');
    expect(prompt).toContain('总结');
    expect(prompt).not.toContain('每轮必须调用且只调用一次 send_danmaku');
    expect(prompt).not.toContain('"score":');
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

it.each([
  { type: 'follow' as const, roomId: 1 },
  { type: 'explore' as const, areaId: 1 },
])('观看模式 $type 明确完成记忆写入，但不强制制造记忆', mode => {
  const prompt = createSystemPrompt(mode);
  expect(prompt).toContain('有就当轮完成查重与写入');
  expect(prompt).toContain('没有就跳过');
  expect(prompt).toContain('send_danmaku 返回后仍可继续调用记忆工具');
  expect(prompt).toContain('remember_current_space_daily_memory');
  expect(prompt).toContain('remember_current_space_long_term_memory');
  expect(prompt).toContain('remember_global_memory');
  expect(prompt).toContain('不重复写入');
  expect(prompt).toContain('get_streamer_dynamics / get_streamer_videos');
  expect(prompt).toContain('实际提供的 B 站 MCP 工具');
  expect(prompt).not.toContain('get_video_transcript：');
  const context = createRoomContext({
    mode,
    startedAt: Date.now(),
    canSwitch: false,
    history: [],
    room: {
      roomId: 1,
      streamerUid: 2,
      streamerName: '测试',
      title: '聊天',
      description: '',
      parentAreaName: '娱乐',
      areaName: '聊天',
      live: true,
    },
  });
  expect(context).toContain('有则按记忆规则查重并调用 remember / update');
  expect(context).not.toContain('主播近期公开信息');
});
