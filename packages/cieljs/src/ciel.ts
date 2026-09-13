import { Runtime } from '@cieljs/runtime';

import { CielResources } from './resources.ts';
import type { Ciel, DefineCielOptions, InvestigateOptions, OpenSessionOptions } from './types.ts';

class CielInstance implements Ciel {
  private currentStatus: Ciel['status'] = 'idle';
  private startPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private resources: CielResources | undefined;
  private runtime: Runtime | undefined;

  constructor(private readonly options: DefineCielOptions) {}

  get status(): Ciel['status'] {
    return this.currentStatus;
  }

  start(): Promise<void> {
    if (this.closePromise) {
      return Promise.reject(new Error('Ciel 已开始关闭'));
    }

    if (this.currentStatus === 'running') {
      return Promise.resolve();
    }

    if (this.currentStatus === 'starting' && this.startPromise) {
      return this.startPromise;
    }

    this.currentStatus = 'starting';
    this.startPromise = this.startResources();

    return this.startPromise;
  }

  session(options: OpenSessionOptions) {
    return this.requireRuntime().session(options);
  }

  investigate(options: InvestigateOptions) {
    return this.requireRuntime().investigate(options);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeResources();

    return this.closePromise;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private async startResources(): Promise<void> {
    try {
      const resources = await CielResources.open(this.options);
      const runtime = new Runtime({
        model: this.options.model,
        apiKey: this.options.apiKey,
        systemPrompt: this.options.systemPrompt,
        tools: [...(this.options.tools ?? []), ...(this.options.mcp?.tools ?? [])],
        investigation: this.options.investigation,
        sessionManager: resources.sessionManager,
        investigationManager: resources.investigationManager,
        memoryManager: resources.memoryManager,
      });

      this.resources = resources;
      this.runtime = runtime;

      await runtime.start();

      if (this.currentStatus !== 'closing') {
        this.currentStatus = 'running';
      }
    } catch (error) {
      this.startPromise = undefined;

      if (this.currentStatus !== 'closing') {
        this.currentStatus = 'idle';
      }

      throw error;
    }
  }

  private async closeResources(): Promise<void> {
    if (this.currentStatus === 'closed') {
      return;
    }

    const starting = this.startPromise;
    this.currentStatus = 'closing';

    if (starting) {
      await Promise.allSettled([starting]);
      this.currentStatus = 'closing';
    }

    // Runtime 先停止所有 Agent，再释放它们依赖的 Session 与 Memory managers。
    const runtimeResults = await Promise.allSettled([this.runtime?.close()]);
    const resourceResults = await Promise.allSettled([this.resources?.[Symbol.asyncDispose]()]);

    this.runtime = undefined;
    this.resources = undefined;
    this.currentStatus = 'closed';

    const failures = [...runtimeResults, ...resourceResults]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason);

    if (failures.length) {
      throw new AggregateError(failures, 'Ciel 关闭时发生错误');
    }
  }

  private requireRuntime(): Runtime {
    if (!this.runtime || this.currentStatus !== 'running') {
      throw new Error(`Ciel 当前不可用：${this.currentStatus}`);
    }

    return this.runtime;
  }
}

export function defineCiel(options: DefineCielOptions): Ciel {
  return new CielInstance(options);
}
