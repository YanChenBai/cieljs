import { Memory } from "./memory.ts";
import type {
  DailyRememberInput,
  LongTermRememberInput,
  MemoryAccess,
  MemoryContext,
  MemoryContextOptions,
  MemoryEntry,
  MemoryFilter,
  MemoryLayer,
  MemoryScope,
  MemorySearchHit,
  MemorySearchOptions,
  RememberInput,
  UpdateMemoryInput,
} from "./types.ts";

type LayerFilter = Omit<MemoryFilter, "layer">;
type LayerContextOptions = Omit<MemoryContextOptions, "layers">;
type LayerRememberInput<Layer extends MemoryLayer> = Layer extends "space.daily"
  ? DailyRememberInput
  : LongTermRememberInput;

export interface MemoryLayerStore<Layer extends MemoryLayer> {
  readonly layer: Layer;
  remember(input: LayerRememberInput<Layer>): Promise<MemoryEntry>;
  get(id: string, options?: MemoryAccess): Promise<MemoryEntry | null>;
  list(options?: LayerFilter): Promise<MemoryEntry[]>;
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchHit[]>;
  context(options?: LayerContextOptions): Promise<MemoryContext>;
  getDate(at?: Date): string;
  update(id: string, input: UpdateMemoryInput): Promise<MemoryEntry>;
  forget(id: string, options: { expectedRevision: number }): Promise<void>;
}

export interface GlobalMemory {
  readonly longTerm: MemoryLayerStore<"global.long_term">;
}

export interface SpaceMemory {
  readonly spaceId: string;
  readonly daily: MemoryLayerStore<"space.daily">;
  readonly longTerm: MemoryLayerStore<"space.long_term">;
  get(id: string, options?: MemoryAccess): Promise<MemoryEntry | null>;
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchHit[]>;
  searchFullText(query: string, options?: MemorySearchOptions): Promise<MemorySearchHit[]>;
  searchTrigram(query: string, options?: MemorySearchOptions): Promise<MemorySearchHit[]>;
  searchVector(query: string, options?: MemorySearchOptions): Promise<MemorySearchHit[]>;
  context(options?: MemoryContextOptions): Promise<MemoryContext>;
}

class MemoryLayerStoreImplementation<Layer extends MemoryLayer> implements MemoryLayerStore<Layer> {
  constructor(
    private readonly memory: Memory,
    readonly layer: Layer,
  ) {}

  remember(input: LayerRememberInput<Layer>): Promise<MemoryEntry> {
    return this.memory.remember({ ...input, layer: this.layer } as RememberInput);
  }

  async get(id: string, options: MemoryAccess = {}): Promise<MemoryEntry | null> {
    const memory = await this.memory.get(id, options);

    return memory?.layer === this.layer ? memory : null;
  }

  list(options: LayerFilter = {}): Promise<MemoryEntry[]> {
    return this.memory.list({ ...options, layer: this.layer });
  }

  search(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchHit[]> {
    return this.memory.search(query, { ...options, layer: this.layer });
  }

  context(options: LayerContextOptions = {}): Promise<MemoryContext> {
    return this.memory.context({ ...options, layers: [this.layer] });
  }

  getDate(at?: Date): string {
    return this.memory.getDate(at);
  }

  async update(id: string, input: UpdateMemoryInput): Promise<MemoryEntry> {
    if (!(await this.get(id, { includeArchived: true, includeExpired: true }))) {
      throw new Error("记忆不存在、不可访问或层级不匹配");
    }

    return this.memory.update(id, input);
  }

  async forget(id: string, options: { expectedRevision: number }): Promise<void> {
    if (!(await this.get(id, { includeArchived: true, includeExpired: true }))) {
      throw new Error("记忆不存在、不可访问或层级不匹配");
    }

    await this.memory.forget(id, options);
  }
}

const spaceMemoryBackends = new WeakMap<SpaceMemory, Memory>();
const spaceGlobalMemories = new WeakMap<SpaceMemory, GlobalMemory>();

export function createGlobalMemory(memory: Memory): GlobalMemory {
  return {
    longTerm: new MemoryLayerStoreImplementation(memory, "global.long_term"),
  };
}

export function createSpaceMemory(
  spaceId: string,
  memory: Memory,
  global: GlobalMemory,
): SpaceMemory {
  const space: SpaceMemory = {
    spaceId,
    daily: new MemoryLayerStoreImplementation(memory, "space.daily"),
    longTerm: new MemoryLayerStoreImplementation(memory, "space.long_term"),
    get: (id, options) => memory.get(id, options),
    search: (query, options) => memory.search(query, options),
    searchFullText: (query, options) => memory.searchFullText(query, options),
    searchTrigram: (query, options) => memory.searchTrigram(query, options),
    searchVector: (query, options) => memory.searchVector(query, options),
    context: (options) => memory.context(options),
  };

  spaceMemoryBackends.set(space, memory);
  spaceGlobalMemories.set(space, global);

  return space;
}

export function getSpaceMemoryBackend(space: SpaceMemory): Memory<MemoryScope> {
  const memory = spaceMemoryBackends.get(space);

  if (!memory) {
    throw new TypeError("无效的空间记忆对象");
  }

  return memory;
}

export function getSpaceGlobalMemory(space: SpaceMemory): GlobalMemory {
  const global = spaceGlobalMemories.get(space);

  if (!global) {
    throw new TypeError("无效的空间记忆对象");
  }

  return global;
}
