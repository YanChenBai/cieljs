// @env node

import { randomUUID } from 'node:crypto';

import type { ASRResult } from '@cieljs/hearing';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { PerceptionFrame, PerceptionSnapshot } from './types.ts';
import { composeVisionFrames } from './vision/composer.ts';

interface SnapshotData {
  readonly startAt: Date;
  readonly endAt: Date;
  readonly transcripts: readonly ASRResult[];
  readonly frames: readonly PerceptionFrame[];
  readonly hearingPrompt: string;
  readonly visionPrompt: string;
  readonly maxFrames: number;
}

export function createPerceptionSnapshot(data: SnapshotData): PerceptionSnapshot {
  return new FrozenPerceptionSnapshot(data);
}

class FrozenPerceptionSnapshot implements PerceptionSnapshot {
  readonly id = randomUUID();
  readonly startAt: Date;
  readonly endAt: Date;
  readonly transcripts: readonly ASRResult[];
  readonly frames: readonly PerceptionFrame[];

  private readonly hearingPrompt: string;
  private readonly visionPrompt: string;
  private readonly maxFrames: number;

  constructor(data: SnapshotData) {
    this.startAt = new Date(data.startAt);
    this.endAt = new Date(data.endAt);
    this.transcripts = Object.freeze(data.transcripts.map(cloneTranscript));
    this.frames = Object.freeze(data.frames.map(cloneFrame));
    this.hearingPrompt = data.hearingPrompt;
    this.visionPrompt = data.visionPrompt;
    this.maxFrames = data.maxFrames;
  }

  async compose(): Promise<AgentMessage[]> {
    const content: Array<
      { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    > = [];

    const images = await this.composeImages();

    if (images.length > 0) {
      content.push({
        type: 'text',
        text: ['# 视觉', this.visionPrompt].filter(Boolean).join('\n\n'),
      });
      content.push(...images);
    }

    if (this.transcripts.length > 0) {
      const transcript = this.transcripts.map(formatTranscript).join('\n');

      content.push({
        type: 'text',
        text: ['# 听觉', this.hearingPrompt, transcript].filter(Boolean).join('\n\n'),
      });
    }

    if (content.length === 0) {
      return [];
    }

    return [
      {
        role: 'user',
        content,
        timestamp: this.endAt.getTime(),
      },
    ];
  }

  private async composeImages() {
    const groups = groupFrames(this.frames);
    const images = [];

    for (const frames of groups.values()) {
      const selected = selectFrames(frames, this.maxFrames);
      const data = await composeVisionFrames(selected.map(frame => frame.data));

      images.push({
        type: 'image' as const,
        data: data.toString('base64'),
        mimeType: 'image/jpeg',
      });
    }

    return images;
  }
}

function groupFrames(frames: readonly PerceptionFrame[]) {
  const groups = new Map<string, PerceptionFrame[]>();

  for (const frame of frames) {
    const group = groups.get(frame.source) ?? [];

    group.push(frame);
    groups.set(frame.source, group);
  }

  return groups;
}

function selectFrames(frames: readonly PerceptionFrame[], limit: number) {
  if (frames.length <= limit) {
    return frames;
  }

  if (limit === 1) {
    return [frames.at(-1)!];
  }

  return Array.from({ length: limit }, (_, index) => {
    const position = Math.round((index * (frames.length - 1)) / (limit - 1));

    return frames[position]!;
  });
}

function formatTranscript(transcript: ASRResult) {
  const speaker = transcript.speaker ? `[${transcript.speaker}]` : '';
  const events = transcript.events?.map(event => event.type).join('、');
  const audioEvents = events ? ` [声音事件（模型识别）：${events}]` : '';

  return `[${transcript.startAt.toISOString()}]${speaker} ${transcript.content}${audioEvents}`;
}

function cloneTranscript(transcript: ASRResult): ASRResult {
  return {
    ...transcript,
    events: transcript.events?.map(event => ({ ...event })),
    startAt: new Date(transcript.startAt),
    endAt: new Date(transcript.endAt),
    tokens: transcript.tokens?.map(token => ({
      ...token,
      startAt: new Date(token.startAt),
      endAt: new Date(token.endAt),
    })),
  };
}

function cloneFrame(frame: PerceptionFrame): PerceptionFrame {
  return {
    ...frame,
    at: new Date(frame.at),
    data: Buffer.from(frame.data),
  };
}
