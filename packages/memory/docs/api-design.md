# Memory API 设计

本文定义 `@cieljs/memory` 第一版重构后的公开 API、数据语义和 Agent 接入边界。

当前版本只实现显式记忆读写、版本历史、内容检索、来源检索和跨空间只读探索，不实现自动记忆整理。调用者或 Agent 必须明确决定一条新记忆属于全局长期记忆、空间长期记忆还是空间每日记忆。

## 设计目标

- 用公开对象固定 scope，避免 Agent 传入或伪造 `spaceId`
- 清楚区分全局长期记忆、空间长期记忆和空间每日记忆
- 更新记忆时保留旧内容、旧来源和完整 revision 历史
- 用通用字符串来源关联业务上下文，不让 Memory 包理解业务结构
- 既能通过来源发现关联 space，也能通过来源定位具体记忆
- 跨 space 能力默认只读，并由宿主显式开启
- 对外只暴露稳定的领域 API，隐藏 Drizzle、PGlite、chunk 和 embedding 任务

## 暂不实现的能力

第一版不包含：

- `space.daily` 自动整理为 `space.long_term`
- `space.long_term` 自动提升为 `global.long_term`
- Organizer、整理 checkpoint 或模型提示词
- 自动定时任务
- Agent 跨 space 写入
- 物理删除记忆
- 历史正文的语义检索

自动整理以后可以作为独立子模块增加，不需要改变本文定义的记忆身份、revision 或来源 API。

## 术语与层级

```ts
export type MemoryLayer = "global.long_term" | "space.long_term" | "space.daily";
```

三个层级的合法数据组合固定为：

| Layer              | `spaceId` | `date` | 含义                                  |
| ------------------ | --------- | ------ | ------------------------------------- |
| `global.long_term` | `null`    | `null` | 跨空间成立的稳定事实和偏好            |
| `space.long_term`  | 非空      | `null` | 只在一个 space 内长期成立的事实       |
| `space.daily`      | 非空      | 非空   | 一个 space 在某天发生的事件和短期状态 |

`spaceId` 是业务定义的不透明字符串。Memory 包只校验它非空，不解析其格式和含义。

所有 space 入口都严格限制在当前 space。`space.search()`、`space.get()`、`space.update()` 和 `space.forget()` 不会隐式访问全局记忆或其他 space。

## 包入口

建议提供三个导出入口：

```json
{
  "exports": {
    ".": "./dist/index.mjs",
    "./agent": "./dist/agent/index.mjs",
    "./package.json": "./package.json"
  }
}
```

主入口只包含存储、检索和生命周期 API：

```ts
import {
  MemoryManager,
  type MemoryEntry,
  type MemorySearchHit,
  type MemorySource,
} from "@cieljs/memory";
```

Agent 入口包含工具和上下文准备 API：

```ts
import { globalMemoryTools, loadMemoryContext, memoryTools } from "@cieljs/memory/agent";
```

Schema、数据库连接、检索实现、索引任务和内部校验器不作为公开子路径导出。

## Sources

### 类型

来源只是参与追溯和检索的字符串：

```ts
export type MemorySource = string;
```

记忆记录直接保存：

```ts
sources: MemorySource[];
```

Memory 包不定义 session、事件、主播或直播间等业务类型。业务可以同时写入稳定标识和可读名称：

```ts
await space.daily.remember({
  content: "今天讨论了新的游戏模式",
  sources: ["bilibili:room:21452505", "主播昵称", "主播旧昵称", "今晚第一次挑战新模式"],
});
```

建议业务对稳定标识使用带命名空间的字符串，例如：

```text
session:conversation-1
message:message-42
bilibili:room:21452505
event:agreement-42
```

Memory 包不解释前缀，只把完整字符串当作可精确匹配和可全文检索的来源。

### 内置处理

写入 sources 时，Memory 包统一执行：

1. Unicode `NFKC` 规范化
2. 去除首尾空白
3. 丢弃空字符串
4. 按规范化值去重
5. 保留第一次出现的顺序和展示文本
6. 校验单项长度、数组数量和总字节数

建议初始限制：

```ts
const MAX_MEMORY_SOURCES = 32;
const MAX_MEMORY_SOURCE_LENGTH = 512;
const MAX_MEMORY_SOURCES_BYTES = 32 * 1024;
```

这些限制属于运行时验证，不要求业务提供自定义 source 解析器。

## 记忆类型

```ts
export type MemoryKind = "event" | "fact" | "preference" | "summary";

export type MemoryStatus = "active" | "archived";
```

一条公开记忆表示某个逻辑记忆的当前 revision：

```ts
interface MemoryEntryFields {
  id: string;
  revision: number;

  kind: MemoryKind;
  content: string;
  sources: MemorySource[];

  status: MemoryStatus;

  occurredAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MemoryEntry = MemoryEntryFields &
  (
    | {
        layer: "global.long_term";
        spaceId: null;
        date: null;
      }
    | {
        layer: "space.long_term";
        spaceId: string;
        date: null;
      }
    | {
        layer: "space.daily";
        spaceId: string;
        date: string;
      }
  );
```

按层级取得具体类型：

```ts
export type MemoryEntryFor<Layer extends MemoryLayer> = Extract<MemoryEntry, { layer: Layer }>;

export type SpaceMemoryEntry = Extract<MemoryEntry, { spaceId: string }>;
```

## 创建记忆

```ts
interface RememberFields {
  content: string;
  kind?: MemoryKind;
  occurredAt?: Date;
  expiresAt?: Date | null;
  sources?: MemorySource[];
}

export type LongTermRememberInput = RememberFields;

export interface DailyRememberInput extends RememberFields {
  /**
   * 省略时根据 occurredAt 和 manager.timeZone 计算
   */
  date?: string;
}
```

长期记忆不能传 `date`。每日记忆省略 `date` 时，先使用 `occurredAt`，两者都省略时使用当前时间，再按 manager 配置的时区计算日期。

`remember()` 始终创建新的逻辑记忆，初始 revision 为 `1`。它不会根据正文或 sources 自动合并已有记忆。

## 更新记忆

```ts
export interface UpdateMemoryInput {
  /**
   * 防止基于旧版本覆盖其他更新
   */
  expectedRevision: number;

  /**
   * 更新后的完整正文，不是文本 diff
   */
  content?: string;

  kind?: MemoryKind;
  expiresAt?: Date | null;

  /**
   * 传入时替换整个来源数组
   */
  sources?: MemorySource[];
}
```

没有传入的字段保持当前值。`sources` 使用整体替换语义，不做隐式合并。

更新不允许修改：

- `id`
- `layer`
- `spaceId`
- `date`
- `occurredAt`
- `createdAt`

如果这些身份字段需要改变，应创建新记忆并遗忘旧记忆。

### Update 不覆盖旧内容

`update()` 不直接覆盖数据库里的旧正文，而是为同一个逻辑记忆新增 revision：

```text
memory-1 / revision 1 / 旧内容
memory-1 / revision 2 / 新内容
```

调用者只传当前看到的 revision 和新字段：

```ts
const memory = await space.get("memory-1");

if (memory) {
  const updated = await space.update(memory.id, {
    expectedRevision: memory.revision,
    content: "修正后的完整内容",
  });

  console.log(updated.revision);
}
```

内部事务按以下顺序执行：

1. 读取并锁定逻辑记忆
2. 校验 scope、状态和 `currentRevision`
3. 读取当前完整 revision
4. 将 patch 与当前 revision 合并
5. 插入下一条完整 revision
6. 更新逻辑记忆的 `currentRevision` 和 `updatedAt`
7. 重建当前 revision 的检索索引
8. 提交事务

如果 `expectedRevision` 已过期，更新失败，调用者应重新读取最新记忆并重新判断。Memory 包不会自动把两个冲突正文合并。

## 遗忘记忆

```ts
export interface ForgetMemoryOptions {
  expectedRevision: number;
}
```

`forget()` 是软遗忘：

- 把逻辑记忆状态改为 `archived`
- 保存 `archivedAt`
- 从正常内容检索和来源检索中移除
- 保留所有 revision 和 sources

第一版不提供物理删除 `purge()`，也不提供 Agent 恢复工具。

## Revision 历史

```ts
export interface MemoryRevision {
  memoryId: string;
  revision: number;

  kind: MemoryKind;
  content: string;
  sources: MemorySource[];

  occurredAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface MemoryHistoryOptions {
  limit?: number;
  beforeRevision?: number;
}
```

正常的 `get()`、`list()`、`search()` 和上下文准备只使用当前 revision。读取旧内容必须显式调用：

```ts
const history = await space.history("memory-1", {
  limit: 20,
});

const oldRevision = await space.getRevision("memory-1", 1);
```

历史内容默认不参与语义检索，避免模型同时召回相互冲突的新旧事实。

## MemoryManager

```ts
export interface MemoryManagerOptions {
  dataDir: string;
  timeZone?: string;
  embedding?: EmbeddingProvider;

  /**
   * 正文与查询共享的分词规则
   */
  tokenize?: (text: string) => string[];

  onIndexError?: (error: unknown) => void;
}

export interface MemoryIndexStatus {
  pending: number;
  ready: number;
  failed: number;
}

export class MemoryManager implements AsyncDisposable {
  static open(options: MemoryManagerOptions): Promise<MemoryManager>;

  readonly timeZone: string;
  readonly global: GlobalLongTermMemory;

  space(spaceId: string): SpaceMemory;

  getAny(id: string, options?: MemoryReadOptions): Promise<MemoryEntry | null>;

  searchAll(query: string, options?: SearchAllMemoryOptions): Promise<MemorySearchHit[]>;

  searchBySource(
    query: string,
    options?: MemorySourceSearchOptions,
  ): Promise<MemorySourceSearchHit[]>;

  findSpacesBySource(
    query: string,
    options?: FindMemorySpacesOptions,
  ): Promise<MemorySpaceSourceHit[]>;

  getIndexStatus(): Promise<MemoryIndexStatus>;
  flushIndexes(): Promise<void>;
  retryIndexes(): Promise<void>;
  rebuildIndexes(): Promise<void>;

  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

默认 `tokenize` 使用单例 `Intl.Segmenter("zh", { granularity: "word" })`，只保留 `isWordLike` 的分段。正文索引和查询必须共用同一 tokenizer；替换 tokenizer 后应调用 `rebuildIndexes()`。

`getAny()`、`searchAll()` 和全库来源搜索是管理端能力。普通 space API 不通过 manager 的全库入口实现隐式回退。

## 分层存储 API

```ts
export interface MemoryReadOptions {
  includeArchived?: boolean;
  includeExpired?: boolean;
}

export interface MemoryListOptions extends MemoryReadOptions {
  kind?: MemoryKind;
  limit?: number;
  offset?: number;
}

export interface SpaceMemoryListOptions extends MemoryListOptions {
  layers?: Array<"space.long_term" | "space.daily">;
  dateFrom?: string;
  dateTo?: string;
}

export interface MemoryLayerStore<Layer extends MemoryLayer, RememberInput> {
  readonly layer: Layer;

  remember(input: RememberInput): Promise<MemoryEntryFor<Layer>>;

  get(id: string, options?: MemoryReadOptions): Promise<MemoryEntryFor<Layer> | null>;

  list(options?: MemoryListOptions): Promise<MemoryEntryFor<Layer>[]>;

  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchHit<Layer>[]>;

  searchBySource(
    query: string,
    options?: Omit<MemorySourceSearchOptions, "layers">,
  ): Promise<MemorySourceSearchHit<Layer>[]>;

  update(id: string, input: UpdateMemoryInput): Promise<MemoryEntryFor<Layer>>;

  forget(id: string, options: ForgetMemoryOptions): Promise<void>;

  history(id: string, options?: MemoryHistoryOptions): Promise<MemoryRevision[]>;

  getRevision(id: string, revision: number): Promise<MemoryRevision | null>;
}
```

## 全局长期记忆

全局对象本身就是长期记忆层，不再使用冗余的 `global.longTerm`：

```ts
export interface GlobalLongTermMemory extends MemoryLayerStore<
  "global.long_term",
  LongTermRememberInput
> {}
```

```ts
await manager.global.remember({
  content: "用户偏好简洁且直接的回答",
  sources: ["session:conversation-1"],
});
```

## SpaceMemory

```ts
export interface SpaceMemory {
  readonly spaceId: string;

  readonly longTerm: MemoryLayerStore<"space.long_term", LongTermRememberInput>;

  readonly daily: MemoryLayerStore<"space.daily", DailyRememberInput>;

  get(id: string, options?: MemoryReadOptions): Promise<SpaceMemoryEntry | null>;

  list(options?: SpaceMemoryListOptions): Promise<SpaceMemoryEntry[]>;

  search(
    query: string,
    options?: SpaceMemorySearchOptions,
  ): Promise<MemorySearchHit<"space.long_term" | "space.daily">[]>;

  searchBySource(
    query: string,
    options?: SpaceMemorySourceSearchOptions,
  ): Promise<MemorySourceSearchHit<"space.long_term" | "space.daily">[]>;

  update(id: string, input: UpdateMemoryInput): Promise<SpaceMemoryEntry>;

  forget(id: string, options: ForgetMemoryOptions): Promise<void>;

  history(id: string, options?: MemoryHistoryOptions): Promise<MemoryRevision[]>;

  getRevision(id: string, revision: number): Promise<MemoryRevision | null>;
}
```

创建记忆仍然使用明确的层级对象：

```ts
await space.daily.remember({
  content: "今天发生的事情",
});

await space.longTerm.remember({
  content: "这个空间长期成立的事实",
});
```

不提供要求调用者再次传入完整 layer 字符串的 `space.remember()`。更新和遗忘只需要 ID，因此在 `space` 上提供聚合入口，内部负责判断记忆属于 daily 还是 long-term。

## 内容搜索

对外只提供一个 `search()`，用 `mode` 选择检索方式，不公开四组平行方法。

```ts
export type MemorySearchMode = "hybrid" | "full_text" | "trigram" | "vector";

export type MemorySearchMatch = "full_text" | "trigram" | "vector";

export interface MemorySearchOptions extends MemoryReadOptions {
  mode?: MemorySearchMode;
  kind?: MemoryKind;

  limit?: number;
  offset?: number;
  candidateLimit?: number;
  minVectorSimilarity?: number;

  signal?: AbortSignal;
}

export interface SpaceMemorySearchOptions extends MemorySearchOptions {
  layers?: Array<"space.long_term" | "space.daily">;
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchAllMemoryOptions extends MemorySearchOptions {
  layers?: MemoryLayer[];
  dateFrom?: string;
  dateTo?: string;
}

export interface MemorySearchHit<Layer extends MemoryLayer = MemoryLayer> {
  memory: MemoryEntryFor<Layer>;
  excerpt: string;

  /**
   * 排名分数，不表示概率
   */
  score: number;

  matches: MemorySearchMatch[];
}
```

默认 `mode` 为 `hybrid`。正常搜索过滤 archived 和 expired 记录，并且只检索当前 revision。

相同 score 使用 `occurredAt DESC, id ASC` 保证稳定排序。

## 来源搜索

来源搜索与正文搜索是两个独立入口。它搜索 `sources`，而不是正文 `content`。

```ts
export type MemorySourceSearchMode = "auto" | "exact" | "text";

export interface MemorySourceSearchOptions extends MemoryReadOptions {
  mode?: MemorySourceSearchMode;

  /**
   * 默认只查询当前 revision
   */
  includeHistory?: boolean;

  layers?: MemoryLayer[];
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface SpaceMemorySourceSearchOptions extends Omit<MemorySourceSearchOptions, "layers"> {
  layers?: Array<"space.long_term" | "space.daily">;
}

export interface MemorySourceSearchHit<Layer extends MemoryLayer = MemoryLayer> {
  memoryId: string;
  revision: number;

  spaceId: MemoryEntryFor<Layer>["spaceId"];
  layer: Layer;
  date: MemoryEntryFor<Layer>["date"];

  matchedSources: MemorySource[];
  excerpt: string;
  score: number;
}
```

模式语义：

- `exact`：完整 source 元素匹配，适合稳定业务标识
- `text`：全文和 trigram 检索，适合名称、标题和别名
- `auto`：先执行精确匹配，再合并文本检索结果

默认不查询历史 revision。启用 `includeHistory` 后，每条结果必须带有准确 revision，调用者使用 `getRevision()` 读取对应旧内容。

### 从来源读取具体记忆

```ts
const hits = await manager.searchBySource("主播昵称", {
  mode: "text",
});

const hit = hits[0];

if (hit?.spaceId) {
  const memory = await manager.space(hit.spaceId).get(hit.memoryId);
}
```

`searchBySource()` 返回 `spaceId + memoryId + revision`，因此调用者不必先聚合 space，也可以直接读取相关具体记忆。

## 通过来源发现 Space

```ts
export interface FindMemorySpacesOptions {
  mode?: MemorySourceSearchMode;
  layers?: Array<"space.long_term" | "space.daily">;
  limit?: number;
  signal?: AbortSignal;
}

export interface MemorySpaceSourceHit {
  spaceId: string;
  score: number;
  matchedSources: MemorySource[];

  memories: Array<{
    id: string;
    revision: number;
    layer: "space.long_term" | "space.daily";
    excerpt: string;
  }>;
}
```

```ts
const relatedSpaces = await manager.findSpacesBySource("bilibili:room:21452505", { mode: "exact" });

for (const related of relatedSpaces) {
  const hits = await manager.space(related.spaceId).search("之前对这个游戏有什么看法");
}
```

`findSpacesBySource()` 使用相同的来源检索结果，按 `spaceId` 聚合。一个 space 只返回一次，并附带有限数量的具体记忆引用，Agent 可以直接读取引用，也可以进一步搜索该 space。

没有任何记忆的空 space 不会被发现。Memory 第一版不维护独立 space 注册表。

## Agent 当前 Space 工具

Agent 工具必须由宿主绑定 `SpaceMemory`，工具参数不能包含 `spaceId`。

```ts
export interface MemorySourceProviderContext {
  toolCallId: string;
  action: "remember" | "update";
  signal?: AbortSignal;
}

export type MemorySourceProvider = (
  context: MemorySourceProviderContext,
) => MemorySource[] | Promise<MemorySource[]>;

export interface MemoryToolsOptions {
  space: SpaceMemory;

  sources?: MemorySource[] | MemorySourceProvider;

  /**
   * Agent 更新记忆时如何处理宿主来源
   *
   * @default "append"
   */
  sourcesMode?: "append" | "replace";

  rememberDaily?: boolean;
  rememberLongTerm?: boolean;
  update?: boolean;
  forget?: boolean;

  searchLimit?: number;
  maxReadChars?: number;

  crossSpace?: CrossSpaceMemoryOptions;
}

export function memoryTools(options: MemoryToolsOptions): AgentTool[];
```

默认提供：

```text
search_current_space_memory
search_current_space_memory_by_source
read_current_space_memory
remember_current_space_daily_memory
remember_current_space_long_term_memory
update_current_space_memory
archive_current_space_memory
```

这些工具全部绑定当前 space。

### 写入工具参数

`remember_current_space_daily_memory`：

```ts
interface RememberDailyMemoryToolInput {
  content: string;
  kind?: MemoryKind;
  date?: string;
  occurredAt?: string;
  expiresAt?: string;
}
```

`remember_current_space_long_term_memory`：

```ts
interface RememberLongTermMemoryToolInput {
  content: string;
  kind?: MemoryKind;
  occurredAt?: string;
  expiresAt?: string;
}
```

`update_current_space_memory`：

```ts
interface UpdateMemoryToolInput {
  id: string;
  expectedRevision: number;

  content?: string;
  kind?: MemoryKind;
  expiresAt?: string | null;
}
```

`archive_current_space_memory`：

```ts
interface ForgetMemoryToolInput {
  id: string;
  expectedRevision: number;
}
```

Agent 不传 `sources`。工具通过静态 sources 或 `MemorySourceProvider` 注入当前 session、消息、事件或其他业务来源。

更新前，Agent 必须先通过 `read_current_space_memory` 取得完整正文和最新 revision。搜索结果中的 excerpt 不能作为完整正文直接覆盖旧版本。

## Agent 跨 Space 工具

跨 space 权限分成两级：

```ts
export type CrossSpaceMemoryAccess = "related" | "all";

export interface CrossSpaceMemoryOptions {
  manager: MemoryManager;
  access: CrossSpaceMemoryAccess;
}
```

没有传 `crossSpace` 时，Agent 只能访问当前 space。

`related` 增加：

```text
find_memory_spaces_by_source
search_discovered_space_memory
search_discovered_space_memory_by_source
read_discovered_space_memory
```

Agent 必须先调用 `find_memory_spaces_by_source`。工具实例记录本次已经发现的 `spaceId`，后续三个工具只接受当前 space 或已经发现的 space。

`all` 在 `related` 基础上增加：

```text
search_all_memory
search_all_memory_by_source
read_any_memory
```

这些跨 space 工具全部只读。开启跨 space 搜索不会扩大 `remember`、`update` 或 `forget` 的作用范围。

## Agent 全局写入工具

全局写入是一项独立授权，不与跨 space 搜索绑定：

```ts
export interface GlobalMemoryToolsOptions {
  memory: GlobalLongTermMemory;
  sources?: MemorySource[] | MemorySourceProvider;
  sourcesMode?: "append" | "replace";

  remember?: boolean;
  update?: boolean;
  forget?: boolean;

  maxReadChars?: number;
}

export function globalMemoryTools(options: GlobalMemoryToolsOptions): AgentTool[];
```

按配置提供：

```text
search_global_memory
search_global_memory_by_source
read_global_memory
remember_global_memory
update_global_memory
archive_global_memory
```

前三个工具用于在全局长期记忆中定位要读取或更新的记录。`remember`、`update` 和 `forget` 配置在调用 `globalMemoryTools()` 后默认开启，也可以分别关闭。

默认的 `memoryTools()` 不包含任何全局读写能力。宿主必须显式创建并加入这组工具。

## Agent 上下文准备

上下文格式化属于 Agent 适配层，不放进存储核心对象：

```ts
export interface LoadMemoryContextOptions {
  manager: MemoryManager;
  space: SpaceMemory;

  globalLongTermTokens?: number;
  spaceLongTermTokens?: number;
  dailyTokens?: number;

  recentDays?: number;
  query?: string;
  countTokens?: (text: string) => number;
  signal?: AbortSignal;
}

export interface MemoryContextSection {
  text: string;
  memories: MemoryEntry[];
  tokens: number;
}

export interface LoadedMemoryContext {
  globalLongTerm: MemoryContextSection;
  spaceLongTerm: MemoryContextSection;
  daily: MemoryContextSection;
}

export function loadMemoryContext(options: LoadMemoryContextOptions): Promise<LoadedMemoryContext>;
```

建议 core 把全局长期记忆和当前 space 长期记忆用于稳定上下文，把近期 daily 记忆作为每次模型调用前刷新的临时上下文。

不同 section 独立计算 token 预算，避免大量 daily 记录挤掉长期记忆。

## 数据库模型

### `memories`

保存逻辑记忆身份和当前状态：

```ts
export const memories = pgTable("memories", {
  id: text("id").primaryKey(),

  layer: text("layer").$type<MemoryLayer>().notNull(),
  spaceId: text("space_id"),
  date: date("date"),

  status: text("status").$type<MemoryStatus>().notNull().default("active"),
  currentRevision: integer("current_revision").notNull().default(1),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});
```

### `memory_revisions`

保存每个 revision 的完整快照：

```ts
export const memoryRevisions = pgTable(
  "memory_revisions",
  {
    memoryId: text("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),

    revision: integer("revision").notNull(),

    kind: text("kind").$type<MemoryKind>().notNull(),
    content: text("content").notNull(),

    sources: text("sources")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    sourceSearchText: text("source_search_text").notNull().default(""),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.memoryId, table.revision] })],
);
```

`sources` 已经收敛为字符串数组，因此使用 `text[]`，不再使用 `jsonb[]`。

### 当前 revision 检索

正文 chunk 和 embedding 只服务当前 revision。更新成功后：

- 新 revision 创建新的 chunks 和 embedding 任务
- 旧 revision 正文仍保存在 `memory_revisions`
- 旧 revision 不进入默认内容检索
- 旧 revision sources 只在 `includeHistory: true` 时参与来源搜索

异步 embedding 任务必须绑定 `memoryId + revision` 或不可复用的 chunk ID，防止旧任务完成后覆盖新 revision 的向量。

### 来源索引

来源搜索使用两类索引：

- `sources text[]` 的 GIN 索引用于完整 source 精确匹配
- `source_search_text` 的 FTS 和 trigram GIN 索引用于名称、标题和别名检索

`sourceSearchText` 由规范化后的 sources 在事务内生成，不接受调用者直接传入。

## 错误类型

调用者需要可靠地区分不存在、越权、版本冲突和关闭状态：

```ts
export type MemoryErrorCode =
  | "MEMORY_NOT_FOUND"
  | "MEMORY_ACCESS_DENIED"
  | "MEMORY_REVISION_CONFLICT"
  | "MEMORY_ARCHIVED"
  | "MEMORY_CLOSED"
  | "MEMORY_VALIDATION_FAILED";

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;
}

export class MemoryNotFoundError extends MemoryError {}
export class MemoryAccessError extends MemoryError {}
export class MemoryConflictError extends MemoryError {}
export class MemoryArchivedError extends MemoryError {}
export class MemoryClosedError extends MemoryError {}
export class MemoryValidationError extends MemoryError {}
```

公开 API 不要求调用者解析中文错误字符串。Agent 工具可以把这些错误转换为稳定且可操作的工具结果。

## 生命周期和索引一致性

`remember()` 和 `update()` 在数据库事务提交后即可被 `get()`、`list()`、全文搜索和来源搜索读取。

向量索引允许异步完成：

```ts
await space.longTerm.remember({
  content: "新的长期记忆",
});

await manager.flushIndexes();

const hits = await space.longTerm.search("相关查询", {
  mode: "vector",
});
```

`close()` 的顺序固定为：

1. 拒绝新的业务操作
2. 等待已经开始的写操作完成
3. 等待已提交的索引任务完成
4. 关闭 PGlite

多次调用 `close()` 返回同一个关闭 Promise。

## 完整使用示例

```ts
import { MemoryManager } from "@cieljs/memory";
import { memoryTools } from "@cieljs/memory/agent";

await using memories = await MemoryManager.open({
  dataDir: ".ciel/memory",
  timeZone: "Asia/Shanghai",
  embedding,
});

const space = memories.space("blive:room:21452505");

await memories.global.remember({
  content: "用户偏好简洁且自然的表达",
  sources: ["session:conversation-1"],
});

await space.longTerm.remember({
  content: "这个直播间经常讨论独立游戏",
  sources: ["bilibili:room:21452505", "主播昵称"],
});

await space.daily.remember({
  content: "今天主播开始体验新的独立游戏",
  sources: ["bilibili:room:21452505", "主播昵称", "今晚第一次挑战新模式"],
});

const relatedSpaces = await memories.findSpacesBySource("主播昵称");

const relatedMemories = await memories.searchBySource("今晚第一次挑战新模式");

const tools = memoryTools({
  space,
  sources: ["session:conversation-1", "bilibili:room:21452505"],
  crossSpace: {
    manager: memories,
    access: "related",
  },
});
```

## 关键设计原因

### 为什么 scope 绑定在对象上

`manager.space(spaceId)` 由宿主创建，Agent 只拿到已经绑定的工具。这样 Agent 不需要传 `spaceId`，也无法借写入参数修改其他空间。

### 为什么拆分两个 remember 工具

Daily 和 long-term 是不同生命周期。拆成 `remember_current_space_daily_memory` 与 `remember_current_space_long_term_memory` 后，工具本身固定目标层级，不需要 Agent 传数据库 layer 字符串。

### 为什么 update 只传新值和 expectedRevision

调用者需要先读取旧内容用于判断，但不需要把旧内容作为参数重复发送。`expectedRevision` 已经能证明更新基于哪个版本，数据库在事务内读取当前快照并创建新 revision。

### 为什么每次 revision 保存完整快照

完整快照让历史读取、回滚分析和来源审计保持简单。记忆正文通常不大，第一版不引入文本 diff、patch 重放或事件溯源复杂度。

### 为什么 sources 使用 string[]

当前需求只需要稳定标识、名称、标题和别名参与查询。字符串数组已经足够表达这些信息，也不会让 Memory 包依赖业务字段结构。

### 为什么来源搜索和正文搜索分开

“这条记忆讲了什么”和“这条记忆来自哪里”是两种不同查询。分开 API 后，调用者能明确选择内容相关性或来源关联性，也更容易控制跨 space 权限。

### 为什么跨 space 默认只读

发现另一个相关 space 不代表有权修改它。跨 space 探索只负责发现、搜索和读取，所有普通写工具仍然绑定当前 space。

### 为什么第一版不整理记忆

自动整理会引入模型决策、调度、批处理、冲突重试和质量评估。先验证分层写入、revision、sources 搜索和 Agent 权限，能以更小边界获得真实使用数据。以后增加 Organizer 时，可以直接消费现有 daily 与 long-term 记录，而不改变本文 API。
