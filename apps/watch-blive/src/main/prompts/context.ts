import type { RoomCandidate, RoomInfo, WatchMode } from '../../shared/types.ts';

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
}): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - input.startedAt) / 1_000));
  const danmakuHistory = input.history.length
    ? input.history
        .map(item => `- ${new Date(item.sentAt).toISOString()} ${item.content}`)
        .join('\n')
    : '（尚未真实发送弹幕）';
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

${input.mode.type === 'recording' ? '' : `# 当前访问已真实发送的弹幕\n\n${danmakuHistory}`}

${input.mode.type === 'recording' ? '' : '# 本轮观看\n\n结合本轮画面、语音和互动判断是否有值得下次回忆的新信息。有则按记忆规则查重并调用 remember / update，完成后再结束本轮；没有则跳过。send_danmaku 的 send / defer 不替代记忆判断，不重复发送弹幕。'}
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
