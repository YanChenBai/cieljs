import type { WatchBridgeEvent } from '../../../shared/ipc.ts';

export function describeWatchEvent(event: WatchBridgeEvent) {
  let text = '';
  if (event.type === 'room_opened') text = `进入 ${event.room.streamerName} · ${event.room.roomId}`;
  if (event.type === 'room_closed') text = `离开 ${event.roomId}：${event.reason}`;
  if (event.type === 'exploration_started') text = `正在寻找直播间 · 分区 ${event.areaId}`;
  if (event.type === 'room_selected') text = `选中直播间 ${event.roomId}`;
  if (event.type === 'danmaku_delivered') text = `已发送：${event.content}`;
  if (event.type === 'danmaku_simulated') text = `模拟弹幕：${event.content}`;
  if (event.type === 'recording_finished') text = `录播播放完成 · 房间 ${event.roomId}`;
  if (event.type === 'error') text = event.message;
  return text;
}
