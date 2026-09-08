import type {
  RoomCandidate,
  RoomInfo,
  StreamerHistory,
  StreamerHistoryItem,
  WatchMode,
} from '../../shared/types.ts';

export interface SentDanmaku {
  content: string;
  sentAt: number;
}

export function createRoomContext(input: {
  room: RoomInfo;
  mode: WatchMode;
  startedAt: number;
  canSwitch: boolean;
  history: readonly SentDanmaku[];
  streamerHistory?: StreamerHistory;
}): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - input.startedAt) / 1_000));
  const danmakuHistory = input.history.length
    ? input.history
        .map(item => `- ${new Date(item.sentAt).toISOString()} ${item.content}`)
        .join('\n')
    : '（尚未真实发送弹幕）';
  const publicHistory = createStreamerHistoryContext(input.streamerHistory);
  const recordingSource =
    input.mode.type === 'recording'
      ? `\n- 录播来源：${input.mode.source.type === 'url' ? input.mode.source.url : input.mode.source.path}`
      : '';

  return `
# 当前${input.mode.type === 'recording' ? '录播' : '直播间'}

- 主播：${input.room.streamerName}（UID：${input.room.streamerUid}）
- 房间：${input.room.roomId}
- 标题：${input.room.title}
- 分区：${input.room.parentAreaName} / ${input.room.areaName}
- 简介：${input.room.description || '无'}
- 已观察：${elapsedSeconds} 秒
- 当前允许切换：${input.canSwitch ? '是' : '否'}
${recordingSource}

${publicHistory}

${input.mode.type === 'recording' ? '' : `# 当前访问已真实发送的弹幕\n\n${danmakuHistory}`}
`.trim();
}

export function createExplorationQuestion(candidates: readonly RoomCandidate[]): string {
  return `
从下面这批真实候选中选择一个最值得进一步观看和自然互动的直播间。只能返回一个 JSON 对象：
{"roomId":123,"reason":"选择原因"}

候选：
${JSON.stringify(candidates)}
`.trim();
}

function createStreamerHistoryContext(history?: StreamerHistory): string {
  if (!history) {
    return '# 主播近期公开信息\n\n（获取失败或暂无公开内容）';
  }

  return [
    '# 主播近期公开信息',
    '以下是公开列表背景，不代表亲历或已看过投稿，不作为当前录播或直播的内容写入记忆。',
    '',
    '## 动态（置顶优先）',
    formatItems(history.dynamics),
    '',
    '## 投稿列表（仅标题）',
    formatItems(history.videos),
  ].join('\n');
}

function formatItems(items: readonly StreamerHistoryItem[]): string {
  if (!items.length) {
    return '（暂无）';
  }

  return items.map(item => `- ${item.pinned ? '[置顶] ' : ''}${item.title}`).join('\n');
}
