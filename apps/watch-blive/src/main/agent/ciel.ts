import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { defineCiel } from '@cieljs/core';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { StartWatchOptions } from '../../shared/types.ts';
import { createSystemPrompt } from '../prompts.ts';

const EXPLORATION_SYSTEM_PROMPT = `你负责从宿主提供的真实 Bilibili 直播间候选中选择一个房间。可通过只读工具检索其他房间的 Session 与 Memory，结合来源判断；不编造候选，最终只返回指定 JSON。`;

/** 三类存储独立落盘；工具闭包由宿主维护当前房间和发送权限。 */
export function createWatchCiel(options: {
  model: Model<Api>;
  mode: StartWatchOptions['mode'];
  dataDir?: string;
  danmakuTool: AgentTool;
}) {
  const root = resolve(options.dataDir ?? join(homedir(), '.ciel'));
  mkdirSync(root, { recursive: true });
  return defineCiel({
    model: options.model,
    systemPrompt: createSystemPrompt(options.mode),
    tools: [options.danmakuTool],
    session: { dataDir: join(root, 'session') },
    memory: { dataDir: join(root, 'memory') },
    investigation: {
      dataDir: join(root, 'investigation'),
      systemPrompt: EXPLORATION_SYSTEM_PROMPT,
    },
    mcp: { enabled: true, configFile: join(root, 'mcp.json') },
  });
}
