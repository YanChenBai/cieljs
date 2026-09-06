export type DanmakuDelivery = "simulate" | "live";

export type WatchMode = { type: "explore"; areaId: number } | { type: "follow"; roomId: number };

export interface StartWatchOptions {
  mode: WatchMode;
  danmakuDelivery?: DanmakuDelivery;
}

export interface Account {
  uid: number;
  name: string;
  face: string;
}

export interface LiveArea {
  id: number;
  name: string;
  children: readonly LiveArea[];
}

export interface RoomInfo {
  roomId: number;
  streamerUid: number;
  streamerName: string;
  title: string;
  description: string;
  parentAreaName: string;
  areaName: string;
  live: boolean;
}

export interface RoomCandidate {
  roomId: number;
  streamerUid: number;
  streamerName: string;
  title: string;
  areaName: string;
}

export type WatchStatus =
  | "idle"
  | "starting"
  | "awaiting-login"
  | "exploring"
  | "opening"
  | "watching"
  | "stopping"
  | "closed";

export type WatchEvent =
  | { type: "status"; status: WatchStatus }
  | { type: "room_opened"; room: RoomInfo }
  | { type: "room_closed"; roomId: number; reason: string }
  | { type: "exploration_started"; areaId: number }
  | { type: "room_selected"; roomId: number; reason: string }
  | { type: "thought_started"; triggerCount: number }
  | { type: "thought_finished"; durationMs: number }
  | { type: "room_evaluated"; score: number; confidence: number; action: "stay" | "explore" }
  | { type: "danmaku_deferred"; reason: string }
  | { type: "danmaku_simulated"; content: string }
  | { type: "danmaku_delivered"; content: string; roomId: number }
  | { type: "error"; stage: string; error: Error };
