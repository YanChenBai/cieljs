import type { RuntimeRecord } from '@cieljs/runtime-protocol';

export interface TraceEntry {
  id: string;
  sequence: number;
  sessionId: string;
  kind: 'message' | 'tool' | 'event';
  name: string;
  label?: string;
  description?: string;
  runId?: string;
  parentRunId?: string;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  model?: { id: string; name: string; provider: string };
  revision?: number;
  raw?: ValueRef;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  endedAt?: number;
  text?: string;
  thinking?: string;
  input?: ValueRef;
  output?: ValueRef;
}

export interface ValueRef {
  id: string;
  path?: string[];
  preview: string;
}
export interface DevtoolsUpdate {
  entries: TraceEntry[];
  steps: TraceEntry[];
}

export type TraceEvent = RuntimeRecord;
