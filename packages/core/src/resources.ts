import { createMcp, type Mcp } from '@cieljs/mcp';
import { MemoryManager } from '@cieljs/memory';
import { SessionManager } from '@cieljs/session';

import type { DefineCielOptions } from './types.ts';

export class CielResources implements AsyncDisposable {
  private constructor(
    private readonly disposables: AsyncDisposableStack,
    readonly sessionManager: SessionManager,
    readonly investigationManager: SessionManager,
    readonly memoryManager: MemoryManager,
    readonly mcp: Mcp | undefined,
  ) {}

  static async open(options: DefineCielOptions): Promise<CielResources> {
    await using disposables = new AsyncDisposableStack();

    const sessionManager = disposables.use(
      await SessionManager.open({
        ...options.session,
        storage: options.storage,
        namespace: 'session',
        vectors: options.vectors,
      }),
    );
    const investigationManager = disposables.use(
      await SessionManager.open({ storage: options.storage, namespace: 'investigation' }),
    );
    const memoryManager = disposables.use(
      await MemoryManager.open({
        ...options.memory,
        storage: options.storage,
        vectors: options.vectors,
      }),
    );

    let mcp: Mcp | undefined;

    if (options.mcp?.enabled) {
      const { enabled: _, ...mcpOptions } = options.mcp;
      mcp = disposables.use(await createMcp(mcpOptions));
    }

    // 全部初始化成功后转移所有权；中途失败由局部栈逆序回收。
    return new CielResources(
      disposables.move(),
      sessionManager,
      investigationManager,
      memoryManager,
      mcp,
    );
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.disposables.disposeAsync();
  }
}
