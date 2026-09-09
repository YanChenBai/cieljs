import type { DevtoolsHost } from '@cieljs/devtools/host';
import type { Ciel } from '@cieljs/runtime';

import type { WatchEvent } from '../../shared/types.ts';
import type { BilibiliApi } from '../bilibili/api.ts';
import { createCandidateSources, createExplorationQuestion } from '../prompts.ts';
import { messageText, parseDecision, RoomSelectionSchema } from './decisions.ts';

/** 候选必须来自本轮 API 结果，避免模型虚构或使用过期房间。 */
export async function selectExplorationRoom(options: {
  areaId: number;
  signal: AbortSignal;
  ciel: Ciel;
  api: BilibiliApi;
  devtools?: DevtoolsHost;
  emit: (event: WatchEvent) => void;
}) {
  const { areaId, signal, ciel, api, devtools, emit } = options;
  const candidates = await api.rooms(areaId);
  devtools?.record('list_live_rooms', candidates, 'bilibili:exploration');
  signal.throwIfAborted();

  if (candidates.length === 0) {
    throw new Error(`分区 ${areaId} 当前没有直播候选`);
  }

  const result = await ciel.investigate({
    spaceId: 'bilibili:exploration',
    signal,
    crossSpace: true,
    sources: createCandidateSources(areaId, candidates),
    question: createExplorationQuestion(candidates),
    onEvent: devtools?.agentListener(`bilibili:exploration:${Date.now()}`),
  });
  signal.throwIfAborted();

  const selection = parseDecision(messageText(result.answer), RoomSelectionSchema);
  const candidate = candidates.find(item => item.roomId === selection.roomId);

  if (!candidate) {
    throw new Error(`Agent 选择的直播间 ${selection.roomId} 不在本轮候选中`);
  }

  emit({ type: 'room_selected', roomId: candidate.roomId, reason: selection.reason });

  return api.room(candidate.roomId);
}
