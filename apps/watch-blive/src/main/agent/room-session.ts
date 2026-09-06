import type { RoomInfo } from "../../shared/types.ts";
import { createRoomSources } from "../prompts.ts";

const watchDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function createRoomSessionOptions(room: RoomInfo, enteredAt: Date) {
  const spaceId = `bilibili:room:${room.roomId}`;

  // 以进入房间时的上海日期分会话；同日重访恢复历史，机器时区不影响身份。
  return {
    spaceId,
    sessionId: `${spaceId}:${watchDate.format(enteredAt)}`,
    crossSpace: true,
    sources: createRoomSources(room),
  };
}
