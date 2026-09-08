import type { MemoryManager } from '@cieljs/memory';
import type { SessionManager } from '@cieljs/session';

export interface InvestigationToolOptions {
  sessionManager: SessionManager;
  memoryManager: MemoryManager;
  spaceId: string;
  crossSpace?: boolean;
  resolveSources: () => string[];
}

export function createInvestigationToolContext(options: InvestigationToolOptions) {
  return {
    options,
    sessionSpace: options.sessionManager.space(options.spaceId),
    memorySpace: options.memoryManager.space(options.spaceId),
  };
}
export type InvestigationToolContext = ReturnType<typeof createInvestigationToolContext>;

/** 结果附带宿主空间与来源；历史数据不能覆盖调查的身份边界。 */
export function investigationResult(details: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }], details };
}
