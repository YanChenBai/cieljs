import { defineTool } from '@cieljs/agent-kit';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';

import type { DanmakuDelivery, RoomInfo, WatchEvent } from '../../shared/types.ts';
import type { LivePage } from '../bilibili/live-page.ts';

export type DanmakuToolResult =
  | { status: 'deferred'; reason: string }
  | { status: 'simulated'; content: string }
  | { status: 'delivered'; content: string; roomId: number };

export interface DanmakuToolContext {
  delivery: () => DanmakuDelivery;
  livePage: LivePage;
  room: () => RoomInfo | undefined;
  sentDanmaku: () => readonly string[];
  canSend: () => boolean;
  emit: (event: WatchEvent) => void;
}

export class DanmakuRunGate {
  private called = false;

  beginRun(): void {
    this.called = false;
  }

  claim(): void {
    if (this.called) {
      throw new Error('本轮已经调用过 send_danmaku');
    }

    this.called = true;
  }
}

const SendDanmakuSchema = Type.Object({
  action: Type.Union([Type.Literal('send'), Type.Literal('defer')]),
  content: Type.String({ maxLength: 40 }),
  reason: Type.String({ minLength: 1, maxLength: 120 }),
});

export const createDanmakuTool = defineTool(
  SendDanmakuSchema,
  (context: DanmakuToolContext, gate: DanmakuRunGate) => ({
    name: 'send_danmaku',
    label: '发送弹幕',
    description: '选择发送一条自然弹幕或暂缓互动；每轮必须且只能调用一次。',
    executionMode: 'sequential',
    async execute(params) {
      gate.claim();

      if (params.action === 'defer') {
        context.emit({ type: 'danmaku_deferred', reason: params.reason });
        return toolResult({ status: 'deferred', reason: params.reason });
      }

      if (!context.canSend()) {
        throw new Error('当前运行阶段不允许发送弹幕');
      }

      const room = context.room();

      if (!room) {
        throw new Error('当前尚未进入直播间');
      }

      const content = params.content.trim();

      if (!content) {
        throw new Error('弹幕不能为空');
      }

      const normalized = normalizeDanmaku(content);
      const isDuplicate = context.sentDanmaku().some(item => normalizeDanmaku(item) === normalized);

      if (isDuplicate) {
        throw new Error('不能重复发送当前访问中已经发过的弹幕');
      }

      if (context.delivery() === 'simulate') {
        context.emit({ type: 'danmaku_simulated', content });
        return toolResult({ status: 'simulated', content });
      }

      const pageResult = await context.livePage.sendDanmaku(content);

      if (!pageResult.accepted) {
        throw new Error(`页面拒绝发送弹幕：${pageResult.message || String(pageResult.code)}`);
      }

      context.emit({ type: 'danmaku_delivered', content, roomId: room.roomId });

      return toolResult({ status: 'delivered', content, roomId: room.roomId });
    },
  }),
);

function toolResult(details: DanmakuToolResult): AgentToolResult<DanmakuToolResult> {
  return {
    content: [{ type: 'text', text: JSON.stringify(details) }],
    details,
  };
}

function normalizeDanmaku(content: string): string {
  return content.toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}
