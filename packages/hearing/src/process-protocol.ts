import type { ASROptions } from './types.ts';

export type ASRWorkerCommand =
  | { type: 'init'; options: ASROptions }
  | { type: 'write'; data: string; startAt: string }
  | { type: 'flush' }
  | { type: 'close' };

export type ASRWorkerEvent =
  | { type: 'ready' }
  | {
      type: 'result';
      data: {
        content: string;
        speaker?: string;
        confidence?: number;
        startAt: string;
        endAt: string;
        tokens?: readonly { content: string; startAt: string; endAt: string }[];
      };
    }
  | { type: 'speechstart' | 'speechend'; at: string }
  | { type: 'error'; message: string; fatal?: boolean };
