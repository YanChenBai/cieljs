import type { RoomCandidate, RoomInfo, WatchMode } from '../../shared/types.ts';
import { COMMON_SYSTEM_PROMPT } from './common.ts';
import { createLiveSystemPrompt } from './live.ts';
import { createFinalOutputPrompt, createModePrompt } from './modes.ts';

export { createExplorationQuestion, createRoomContext } from './context.ts';
export type { SentDanmaku } from './context.ts';
export { BILIBILI_EMOJI_TAGS, ROOM_REVIEW_AFTER_MS } from './modes.ts';

export function createSystemPrompt(mode: WatchMode): string {
  if (mode.type !== 'recording') return createLiveSystemPrompt(mode);

  return [
    COMMON_SYSTEM_PROMPT,
    createModePrompt(mode),
    `## 最终输出\n\n${createFinalOutputPrompt(mode)}`,
  ].join('\n\n');
}

export function createRoomSources(room: RoomInfo): string[] {
  return [
    `bilibili:room:${room.roomId}`,
    `bilibili:streamer:${room.streamerUid}`,
    `bilibili:streamer-name:${encodeURIComponent(room.streamerName.trim())}`,
  ];
}

export function createCandidateSources(areaId: number, _candidates: readonly RoomCandidate[]) {
  return [`bilibili:area:${areaId}`];
}
