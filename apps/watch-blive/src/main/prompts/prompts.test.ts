import { describe, expect, it } from 'vite-plus/test';

import type { RoomCandidate } from '../../shared/types.ts';
import {
  CIEL_PERSONA_PROMPT,
  createCandidateSources,
  createExplorationQuestion,
  createPerceptionContext,
  createRoomContext,
  createRoomSources,
  createSystemPrompt,
  HEARING_PROMPT,
} from '../prompts';
import { ROOM_REVISIT_COOLDOWN_MS } from '../room-history.ts';

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

describe('探索选房问题', () => {
  const candidate: RoomCandidate = {
    roomId: 789,
    streamerUid: 7890,
    streamerName: '二号主播',
    title: '唱歌',
    areaName: '唱见',
  };
  const cooldownMs = ROOM_REVISIT_COOLDOWN_MS;

  it('没有上一段和冷却时只给候选', () => {
    const question = createExplorationQuestion([candidate], {
      cooled: [],
      relaxed: false,
      cooldownMs,
    });

    expect(question).toContain('"roomId":789');
    expect(question).not.toContain('# 上一段观看');
    expect(question).not.toContain('# 冷却中的房间');
  });

  it('注入上一段观看的现场事实与离开原因，但不带上一轮评价', () => {
    const question = createExplorationQuestion([candidate], {
      previous: {
        room: {
          roomId: 123,
          streamerUid: 456,
          streamerName: '旧主播',
          title: '旧标题',
          description: '',
          parentAreaName: '娱乐',
          areaName: '聊天',
          live: true,
        },
        watchedSeconds: 252,
        reason: '宿主评分判定继续观看价值不足',
      },
      cooled: [],
      relaxed: false,
      cooldownMs,
    });

    expect(question).toContain('刚离开：旧主播（房间 123）· 旧标题');
    expect(question).toContain('分区：娱乐 / 聊天');
    expect(question).toContain('已观看 4 分 12 秒');
    expect(question).toContain('宿主评分判定继续观看价值不足');
    expect(question).toContain('不要选它');
    expect(question).not.toContain('score');
    expect(question).not.toContain('confidence');
  });

  it('列出冷却中的房间与剩余时间', () => {
    const question = createExplorationQuestion([candidate], {
      cooled: [
        { roomId: 123, streamerName: '旧主播', title: '旧标题', leftAt: Date.now() - 3 * 60_000 },
      ],
      relaxed: false,
      cooldownMs,
    });

    expect(question).toContain('# 冷却中的房间');
    expect(question).toContain('- 旧主播（房间 123）· 旧标题 · 离开 3 分钟，还有 27 分钟');
    expect(question).toContain('已从候选中移除');
    expect(question).not.toContain('冷却已放宽');
  });

  it('冷却清空候选时说明已放宽，并要求优先考虑最久没看的', () => {
    const question = createExplorationQuestion([candidate], {
      cooled: [
        { roomId: 789, streamerName: '二号主播', title: '唱歌', leftAt: Date.now() - 29 * 60_000 },
      ],
      relaxed: true,
      cooldownMs,
    });

    expect(question).toContain('冷却已放宽');
    expect(question).toContain('还有 1 分钟');
    expect(question).toContain('从早到晚');
    expect(question).not.toContain('已从候选中移除');
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

describe('人设提示词', () => {
  it.each([
    { type: 'follow' as const, roomId: 1 },
    { type: 'explore' as const, areaId: 1 },
    {
      type: 'recording' as const,
      roomId: 1,
      source: { type: 'file' as const, path: '/video.mp4' },
    },
  ])('$type 模式的系统提示词带人设与优先级约束', mode => {
    const text = createSystemPrompt(mode);
    const taskHeading = mode.type === 'recording' ? '# Bilibili 内容陪伴' : '# Bilibili 直播陪伴';

    expect(text.indexOf('夏尔（Ciel）')).toBeLessThan(text.indexOf(taskHeading));
    expect(text).toContain('## 人设边界');
    expect(text).toContain('任务优先');
    expect(text).toContain('不改变决策');
    expect(text).toContain('不污染结构化输出');
  });

  it('人设不写决策对象，不污染结构化输出', () => {
    expect(CIEL_PERSONA_PROMPT).not.toContain('"action"');
    expect(CIEL_PERSONA_PROMPT).not.toContain('"score"');
    expect(CIEL_PERSONA_PROMPT).not.toContain('{');
  });

  it('人设声明弹幕与评分规则优先，不改变弹幕行为', () => {
    expect(CIEL_PERSONA_PROMPT).toContain(
      '弹幕、评分、切房、记忆与工具调用的规则完整优先于角色设定',
    );
    expect(CIEL_PERSONA_PROMPT).toContain('弹幕内容与语气');
    expect(CIEL_PERSONA_PROMPT).toContain('都不因角色性格而改变');
  });
});

describe('感知提示词', () => {
  it('视觉使用包提供的默认 context', () => {
    const context = createPerceptionContext({
      modality: 'vision',
      snapshotId: 'snapshot',
      startAt: new Date(0),
      endAt: new Date(1),
      frames: [],
      sources: [],
    });

    expect(context).toContain('画面按来源多帧合并');
  });

  it('听觉 context 同时带转写说明和可靠性规则', () => {
    expect(HEARING_PROMPT).toContain('以画面和上文为准');
    expect(HEARING_PROMPT).toContain('没听清');
    expect(HEARING_PROMPT).not.toContain('不写入记忆');
    expect(HEARING_PROMPT).not.toContain('不假装听懂');
    const context = createPerceptionContext({
      modality: 'hearing',
      snapshotId: 'snapshot',
      startAt: new Date(0),
      endAt: new Date(1),
      transcripts: [],
    });

    expect(context).toContain(HEARING_PROMPT);
    expect(context).toContain('## 感知');
    expect(context).toContain('凭空生成');
    expect(context).toContain('不写入记忆');
    expect(context).toContain('不假装听懂');
    expect(context).toContain('不因为一句可疑就否定');
    expect(createSystemPrompt({ type: 'follow', roomId: 1 })).not.toContain('听觉转写由 ASR 生成');
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
  expect(context).not.toContain('# 本轮观看');
  expect(prompt).toContain('结合本轮画面、语音和互动判断');
  expect(prompt).toContain('已经发送过的内容不重复发送');
  expect(context).not.toContain('主播近期公开信息');
});
