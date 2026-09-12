import type { ASRModelId } from '@cieljs/hearing';

import type {
  Account,
  HearingModelStatus,
  LiveArea,
  RoomInfo,
  StartWatchOptions,
  WatchEvent,
  WatchStatus,
  WatchConfigurationStatus,
} from './types.ts';

export const WATCH_BLIVE_IPC = {
  attachLiveWebContents: 'watch-blive:live-page:attach',
  start: 'watch-blive:start',
  stop: 'watch-blive:stop',
  login: 'watch-blive:login',
  logout: 'watch-blive:logout',
  account: 'watch-blive:account',
  areas: 'watch-blive:areas',
  snapshot: 'watch-blive:snapshot',
  event: 'watch-blive:event',
} as const;

export type WatchBridgeEvent =
  | { type: 'room_requested'; roomId: number }
  | Exclude<WatchEvent, { type: 'error' }>
  | { type: 'error'; stage: string; message: string };
export interface WatchSnapshot {
  status: WatchStatus;
  room?: RoomInfo;
}

export interface WatchBliveBridge {
  attachLiveWebContents(input: { id: number }): Promise<void>;
  openBrowseWindow(): Promise<void>;
  start(options: StartWatchOptions): Promise<void>;
  stop(): Promise<void>;
  login(): Promise<Account>;
  logout(): Promise<void>;
  account(): Promise<Account | undefined>;
  areas(): Promise<readonly LiveArea[]>;
  configuration(): Promise<WatchConfigurationStatus>;
  hearingModels(): Promise<HearingModelStatus>;
  selectHearingModel(model: ASRModelId): Promise<HearingModelStatus>;
  installHearingModels(): Promise<HearingModelStatus>;
  pickRecordingFile(): Promise<string | undefined>;
  snapshot(): Promise<WatchSnapshot>;
  onEvent(listener: (event: WatchBridgeEvent) => void): () => void;
}
