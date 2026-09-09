import { runInvestigation } from './agents/investigation-agent.ts';
import { createCielSessionAgent, type SessionAgentHandle } from './agents/session-agent.ts';
import { CielResources } from './resources.ts';
import { createSourceResolver } from './sources.ts';
import { assertDistinctStorage } from './storage.ts';
import type {
  Ciel,
  CielSession,
  CielStatus,
  DefineCielOptions,
  InvestigateOptions,
  InvestigationResult,
  OpenSessionOptions,
} from './types.ts';

class CielSessionRuntime implements CielSession {
  readonly id: string;
  readonly spaceId: string;
  readonly agent: CielSession['agent'];

  constructor(private readonly handle: SessionAgentHandle) {
    this.id = handle.session.id;
    this.spaceId = handle.session.spaceId;
    this.agent = handle.agent;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  close() {
    return this.handle.close();
  }
}

class CielRuntime implements Ciel {
  private currentStatus: CielStatus = 'idle';
  private startPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private resources: CielResources | undefined;

  private readonly sessions = new Set<SessionAgentHandle>();
  private readonly sessionOpenings = new Set<Promise<SessionAgentHandle>>();
  private readonly investigations = new Set<Promise<unknown>>();

  constructor(private readonly options: DefineCielOptions) {}

  get status() {
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

    if (this.currentStatus === 'closing' || this.currentStatus === 'closed') {
      return Promise.reject(new Error(`Ciel 已开始关闭：${this.currentStatus}`));
    }

    this.currentStatus = 'starting';
    this.startPromise = this.startResources();

    return this.startPromise;
  }

  async session(options: OpenSessionOptions): Promise<CielSession> {
    this.assertRunning();

    const resources = this.requireResources();
    const resolveSources = createSourceResolver(options.sources);
    const opening = createCielSessionAgent({
      model: this.options.model,
      apiKey: this.options.apiKey,
      systemPrompt: this.options.systemPrompt,
      tools: [...(this.options.tools ?? []), ...(resources.mcp?.tools ?? [])],
      sessionManager: resources.sessionManager,
      memoryManager: resources.memoryManager,
      sessionId: options.sessionId,
      spaceId: options.spaceId,
      crossSpace: options.crossSpace,
      resolveSources,
      assertRunning: this.assertRunning.bind(this),
      onClose: this.removeSession.bind(this),
    });
    this.sessionOpenings.add(opening);

    let handle: SessionAgentHandle;

    try {
      handle = await opening;
    } finally {
      this.sessionOpenings.delete(opening);
    }

    this.sessions.add(handle);

    return new CielSessionRuntime(handle);
  }

  investigate(options: InvestigateOptions): Promise<InvestigationResult> {
    this.assertRunning();

    const resources = this.requireResources();
    const resolveSources = createSourceResolver(options.sources);
    const investigation = runInvestigation({
      model: this.options.model,
      apiKey: this.options.apiKey,
      systemPrompt: this.options.investigation?.systemPrompt ?? this.options.systemPrompt,
      tools: this.options.investigation?.tools ?? [],
      sessionManager: resources.sessionManager,
      investigationManager: resources.investigationManager,
      memoryManager: resources.memoryManager,
      sessionId: options.sessionId,
      spaceId: options.spaceId,
      crossSpace: options.crossSpace,
      resolveSources,
      question: options.question,
      signal: options.signal,
      onEvent: options.onEvent,
    });

    this.investigations.add(investigation);
    void investigation.then(
      () => this.investigations.delete(investigation),
      () => this.investigations.delete(investigation),
    );

    return investigation;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeResources();

    return this.closePromise;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private async startResources() {
    try {
      this.resources = await CielResources.open(this.options);

      if (this.currentStatus !== 'closing') this.currentStatus = 'running';
    } catch (error) {
      this.startPromise = undefined;
      if (this.currentStatus !== 'closing') this.currentStatus = 'idle';

      throw error;
    }
  }

  private async closeResources() {
    if (this.currentStatus === 'closed') {
      return;
    }

    // 先阻止新操作；即使启动失败，关闭仍需完成并进入终态。
    const starting = this.startPromise;
    this.currentStatus = 'closing';
    if (starting) {
      await Promise.allSettled([starting]);
      this.currentStatus = 'closing';
    }
    const openingResults = await Promise.allSettled(this.sessionOpenings);
    const activeResults = await Promise.allSettled([
      ...[...this.sessions].map(session => session.close()),
      ...this.investigations,
    ]);
    const storageResults = await Promise.allSettled([this.resources?.[Symbol.asyncDispose]()]);

    this.currentStatus = 'closed';
    this.resources = undefined;

    const failures = [...openingResults, ...activeResults, ...storageResults]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason);

    if (failures.length) {
      throw new AggregateError(failures, 'Ciel 关闭时发生错误');
    }
  }

  private assertRunning() {
    if (this.closePromise || this.currentStatus !== 'running') {
      throw new Error(`Ciel 当前不可用：${this.currentStatus}`);
    }
  }

  private requireResources(): CielResources {
    if (!this.resources) {
      throw new Error('Ciel 尚未完成启动');
    }

    return this.resources;
  }

  private removeSession(session: SessionAgentHandle) {
    this.sessions.delete(session);
  }
}

export function defineCiel(options: DefineCielOptions): Ciel {
  assertDistinctStorage(options);

  return new CielRuntime(options);
}
