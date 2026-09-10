import type { McpTools } from '@cieljs/mcp';
import { defineCiel } from '@cieljs/runtime';
import type { Storage } from '@cieljs/storage';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { WatchMode } from '../../shared/types.ts';
import { createSystemPrompt } from '../prompts/index.ts';

const EXPLORATION_SYSTEM_PROMPT = `你负责从宿主提供的真实 Bilibili 直播间候选中选择一个房间。可通过只读工具检索其他房间的 Session 与 Memory，结合来源判断；不编造候选，最终只返回指定 JSON。`;

/** 共享数据库由宿主维护；工具闭包由宿主维护当前房间和发送权限。 */
export function createWatchCiel(options: {
  storage: Storage;
  model: Model<Api>;
  apiKey?: string;
  mode: WatchMode;
  mcp?: McpTools;
  danmakuTool?: AgentTool;
}) {
  return defineCiel({
    model: options.model,
    apiKey: options.apiKey,
    systemPrompt: createSystemPrompt(options.mode),
    tools: options.danmakuTool ? [options.danmakuTool] : [],
    storage: options.storage,
    investigation: {
      systemPrompt: EXPLORATION_SYSTEM_PROMPT,
    },
    mcp: options.mcp,
  });
}
