import { memoryTools } from '@cieljs/memory/agent';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import {
  createInvestigationToolContext,
  type InvestigationToolOptions,
} from './investigation-tools/context.ts';
import { createReadMemoryTool, createSearchMemoryTool } from './investigation-tools/memory.ts';
import { createReadSessionTool, createSearchSessionsTool } from './investigation-tools/sessions.ts';

/** 调查只装配只读工具；跨空间权限由宿主选项决定，不由模型参数控制。 */
export function createInvestigationTools(options: InvestigationToolOptions): AgentTool[] {
  const context = createInvestigationToolContext(options);
  const tools: AgentTool[] = [
    createSearchMemoryTool(context),
    createReadMemoryTool(context),
    createSearchSessionsTool(context),
    createReadSessionTool(context),
  ];
  if (!options.crossSpace) return tools;

  const crossSpaceTools = memoryTools({
    space: context.memorySpace,
    crossSpace: { manager: options.memoryManager, access: 'related' },
    rememberDaily: false,
    rememberLongTerm: false,
    update: false,
    forget: false,
  });
  return [...crossSpaceTools, ...tools];
}
