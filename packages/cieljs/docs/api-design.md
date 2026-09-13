# `cieljs` API 设计

> 状态：设计草案，尚未实现。

`cieljs` 负责定义和运行 Ciel，并组合模型、Runtime、Session、Memory 与隔离的 Investigation Agent。

这份设计从核心职责出发，不以当前 Core 实现作为兼容基础。

## 设计目标

- 使用 `defineCiel()` 作为唯一的 Ciel 定义入口。
- Session ID、空间 ID 和来源均由宿主明确提供。
- 来源支持动态函数，在实际使用时读取最新值。
- Session 与 Memory 保持独立的数据语义和存储边界。
- 使用 `investigate()` 发起一次完全独立的检索调查。
- Investigation 没有自己的 Memory，默认不恢复历史上下文。
- 显式传入 `sessionId` 时，可以恢复对应的 Investigation Session。
- Investigation 可以只读检索目标 Ciel 的 Memory、Session 和宿主数据。
- Investigation Session 使用独立 namespace 保存，不与普通 Session 混合。
- Core 统一管理内部资源的启动和关闭顺序。

## 核心概念

### Session

Session 保存真实发生过的对话消息，是对话历史的事实流水。

它负责：

- 保存用户、助手和工具结果消息。
- 恢复同一个 Session 的历史上下文。
- 使用 `spaceId` 隔离不同业务空间。
- 使用 `sources` 记录本次对话关联的外部来源。

Session 不负责判断哪些内容值得长期保留，也不等同于 Memory。

### Memory

Memory 保存从历史交互中整理出的长期信息，例如稳定事实、偏好、事件和摘要。

它负责：

- 在生成模型上下文时召回相关信息。
- 为普通 Ciel Session 提供明确的记忆检索和写入能力。
- 区分全局记忆、空间长期记忆和空间每日记忆。

召回结果只进入当前模型上下文，不复制到 Session。即使 Memory 可以从 Session 重新整理，也不能反过来替代原始 Session。

### Investigation

Investigation 是一个默认按调用隔离的检索 Agent。

它主要用于把“从大量历史资料中找出答案”从主 Agent 的上下文中分离出来。例如：

- 查询某个空间中曾经发生过什么。
- 从长期记忆中寻找与问题相关的事实。
- 检索原始 Session，核对记忆是否准确。
- 查询宿主提供的感知、直播间或其他场景数据。
- 将多个检索结果整理为带来源的答案。

未传 `sessionId` 时，每次 `investigate()` 都创建新的 Investigation Session，并使用全新的模型上下文。上一次 Investigation 的用户消息、推理过程、工具结果和回答不会进入下一次调用。

显式传入 `sessionId` 时，Core 会从独立存储中恢复该 Investigation Session 的上下文。这是一项显式续接能力，不会让 Investigation 自动发现或检索其他 Investigation Session。

Investigation Session 同时可用于审计、调试和观测，但始终不是 Memory。

## 存储边界

一个 Ciel 运行时拥有三套相互独立的存储：

```text
Session        ── 普通对话历史，会恢复到后续上下文
Memory         ── 长期记忆，会按需召回
Investigation  ── 隔离调查 Session，默认新建并可显式恢复
```

宿主创建一个 Storage，各模块使用独立 schema。普通 Session 与 Investigation 使用不同 namespace，Memory 独立维护业务规则。

Investigation 不获得搜索自身或其他 Investigation Session 的工具。只有宿主显式传入 `sessionId` 时，Core 才会恢复指定历史；这些消息不会自动进入普通 Session 或 Memory。

## `defineCiel()`

`defineCiel()` 定义完整的 Ciel 运行时：

```ts
export interface DefineCielOptions {
  model: Model;
  systemPrompt: string;

  storage: Storage;
  vectors?: VectorService;

  tools?: AgentTool[];

  mcp?: McpTools;

  investigation?: {
    model?: Model;
    systemPrompt?: string;
    tools?: AgentTool[];
  };
}

export function defineCiel(options: DefineCielOptions): Ciel;
```

`defineCiel()` 本身只完成定义，不执行异步 I/O。存储初始化由显式生命周期方法负责：

宿主显式创建 VectorService，通过 `vectors` 注入。普通 Session 与 Memory 共享向量缓存，Investigation 默认不建立向量索引。`embedding` 透传 Qwen 配置，其中 `cacheDir` 控制 Transformers.js 的本地模型缓存目录。宿主显式传入 `storage.session.embedding` 或 `storage.memory.embedding` 时，分别覆盖对应默认值。Investigation Session 不提供自身检索工具，因此不注入默认 embedding。

`mcp` 接收来自 `@cieljs/mcp` 的 `McpTools` 结构接口，只需要只读 `tools`。实例由宿主创建、复用和关闭，Ciel 不负责服务连接的生命周期。

```ts
const ciel = defineCiel(options);

await ciel.start();

// 使用 Session 或 Investigation

await ciel.close();
```

采用显式 `start()`，可以让定义阶段保持同步，也能清楚表达数据库初始化、迁移和资源释放的失败边界。

## Ciel 运行时

```ts
export interface Ciel {
  readonly status: 'idle' | 'starting' | 'running' | 'closing' | 'closed';

  start(): Promise<void>;

  session(options: OpenSessionOptions): Promise<CielSession>;

  investigate(options: InvestigateOptions): Promise<InvestigationResult>;

  close(): Promise<void>;
}
```

行为约束：

- `start()` 可以重复调用，但只执行一次初始化。
- `session()` 和 `investigate()` 只能在运行状态调用。
- `close()` 等待正在执行的 Agent 和 Investigation 完成，再关闭业务 Manager；共享 Storage 由宿主最后关闭。
- 开始关闭后不再允许创建新的 Session 或 Investigation。

## Session 身份与动态来源

```ts
export type SessionSources = string[] | (() => string[]);

export interface OpenSessionOptions {
  sessionId?: string;
  spaceId: string;
  sources?: SessionSources;
}
```

### `sessionId`

- 由宿主传入时，打开或恢复指定 Session。
- 省略时，由 Session 存储创建新 ID。
- Core 不根据 `spaceId` 或 `sources` 隐式推导 Session ID。

### `spaceId`

- 必须由宿主明确传入。
- 在一个 Session 实例的生命周期内保持不变。
- 决定 Session、Memory 和检索工具的默认访问范围。

### `sources`

静态来源：

```ts
sources: ['room:1000', 'streamer:42'];
```

动态来源：

```ts
sources: () => [currentRoomId, currentPageId];
```

Core 不在打开 Session 时永久缓存动态来源。它会在以下边界重新调用 `sources()`：

- 开始一次 Agent 运行前。
- 构造模型上下文时。
- 执行 Session、Memory 或宿主检索工具时。
- 写入 Memory 时。

返回结果需要复制并标准化，避免宿主后续修改原数组影响当前操作。空字符串应被移除，重复来源按首次出现顺序去重。

## 普通 Session API

```ts
export interface CielSession {
  readonly id: string;
  readonly spaceId: string;
  readonly agent: Agent;

  close(): Promise<void>;
}
```

使用方式：

```ts
let roomId = 'room:1000';

const session = await ciel.session({
  sessionId: 'conversation:1',
  spaceId: 'livestream',
  sources: () => [roomId],
});

await session.agent.prompt('总结当前直播间的情况');
```

一次生成的上下文组合顺序为：

```text
基础 System Prompt
        ↓
当前 Session 身份与动态来源
        ↓
相关 Memory 召回结果
        ↓
已保存的 Session 上下文
        ↓
当前用户输入与工具结果
```

Memory 召回内容应带有明确的来源和时间信息，并标记为历史资料，不能被当作当前用户指令。

消息持久化顺序：

1. 接收 Agent 的完整消息事件。
2. 按产生顺序写入 Session。
3. Session 写入成功后才认为该消息已经持久化。
4. Memory 操作独立执行，Memory 失败不能回滚或删除已经发生的 Session 消息。

第一版不自动把每轮对话提炼成 Memory。长期信息通过明确的 Memory 工具写入，避免 Core 在没有策略的情况下擅自保存所有内容。

## `investigate()`

`investigate()` 每次执行一轮调查并直接返回结果。默认创建新 Session，也可以通过显式 `sessionId` 续接此前调查。

```ts
export interface InvestigateOptions {
  sessionId?: string;
  spaceId: string;
  sources?: SessionSources;

  question: string | AgentMessage[];

  signal?: AbortSignal;
}

export interface InvestigationResult {
  sessionId: string;
  answer: AgentMessage;
  messages: AgentMessage[];
}
```

使用方式：

```ts
const result = await ciel.investigate({
  sessionId: 'memory-question:1',
  spaceId: 'livestream',
  sources: () => [currentRoomId],
  question: '主播以前提到过喜欢什么类型的游戏？',
});

await session.agent.prompt([
  {
    role: 'user',
    content: '请结合以下调查结果继续判断',
  },
  result.answer,
]);
```

`sessionId` 的语义与普通 Session 一致：

- 省略时创建新的 Investigation Session，本次上下文完全独立。
- 传入时恢复指定 Investigation Session，并在其历史之后继续本次调查。
- Core 不会根据 `spaceId`、`sources` 或问题内容自动选择已有 Session。
- Investigation 没有搜索自身或其他 Investigation Session 的工具。

Investigation 的模型和 System Prompt 默认继承 Ciel 定义，也可以通过 `DefineCielOptions.investigation` 单独配置。

每次 Investigation 的上下文固定为：

```text
Investigation System Prompt
        ↓
本次 spaceId 与动态 sources
        ↓
显式恢复的 Investigation 历史（仅传入 sessionId 时）
        ↓
本次 question
        ↓
本次调用产生的只读检索结果
```

默认新建 Investigation Session 时，以下内容不会进入上下文：

- 普通 Session 自动恢复出的完整历史。
- 以前的 Investigation Session 记录。
- Investigation 自己的长期记忆。
- 未被工具检索到的 Memory 或 Session 数据。

## Investigation 检索能力

Investigation 没有自己的 Memory，但可以只读查询目标 Ciel 的数据。

Core 可以提供以下类型的只读工具：

```text
search_memory
read_memory
search_sessions
read_session
```

宿主还可以通过 `DefineCielOptions.investigation.tools` 提供其他只读检索工具，例如感知时间线、直播间事件或业务数据库查询。

工具访问范围由 Core 注入：

- `spaceId` 来自本次 `investigate()` 参数。
- `sources` 在每次工具执行时重新调用动态来源函数。
- 模型不能通过工具参数覆盖 `spaceId`。
- 默认不能跨空间检索。
- 不提供 Memory 创建、更新、归档或删除能力。
- 不提供普通 Session 写入、更新或删除能力。

这意味着 Investigation 可以回答有关 Memory 的问题，但不能拥有或修改 Memory。

## Investigation Session

每次调用都在独立存储中创建或恢复一个 Investigation Session：

```ts
export interface InvestigationRunRecord {
  runId: string;
  sessionId: string;
  spaceId: string;
  sources: string[];
  question: AgentMessage[];
  messages: AgentMessage[];
  startedAt: Date;
  completedAt: Date;
  status: 'completed' | 'failed' | 'aborted';
}
```

该存储服务于：

- 宿主使用 `sessionId` 显式恢复调查上下文。
- 调试 Investigation 的工具选择和回答过程。
- 在 Devtool 中展示调查时间线。
- 统计耗时、模型调用和失败原因。
- 人工审计一次回答引用了哪些资料。

Investigation 自己不能搜索这套存储。只有下一次调用明确传入相同 `sessionId` 时，已保存消息才参与模型上下文构造。

## 工具边界

普通 Session 可以获得：

- 宿主提供的 Ciel 工具。
- 当前空间的 Session 检索工具。
- 当前空间和全局 Memory 的读写工具。
- 宿主明确提供的其他能力。

Investigation 只能获得：

- Session 只读检索工具。
- Memory 只读检索工具。
- `DefineCielOptions.investigation.tools` 中明确提供的只读工具。

Core 在创建 Agent 前检查工具名称。出现重复名称时应直接失败，不能依赖数组顺序静默覆盖。

## 错误边界

- Session 持久化失败：当前 Agent 运行失败，并向调用者返回错误。
- Memory 召回失败：记录可观察错误，本轮可以在没有 Memory 的情况下继续。
- 普通 Session 的 Memory 工具失败：作为工具错误返回给 Agent。
- Investigation 检索失败：工具错误保留在本次记录中，由 Agent 判断是否还能回答。
- 动态 `sources()` 抛错：当前操作失败，不复用上一次来源快照。
- Investigation 记录持久化失败：调查结果不能被视为完整成功。

Core 不静默吞掉错误。后续实现需要提供统一的错误观察接口，但不应在基础库中直接写死 `console.log()` 或 `console.error()`。

## 资源关闭

关闭单个普通 Session 时：

1. 等待当前 Agent 运行结束。
2. 等待消息持久化队列清空。
3. 取消内部事件订阅。
4. 从 Ciel 的活动 Session 集合中移除。

一次 Investigation 在返回结果前已经完成生成和 Session 写入，不额外暴露 `close()`。

关闭 Ciel 时：

1. 禁止创建新的 Session 和 Investigation。
2. 等待所有活动 Session 和 Investigation 完成。
3. 刷新待处理索引和持久化任务。
4. 关闭普通 Session 存储。
5. 关闭 Investigation 记录存储。
6. 关闭 Memory 存储。

`close()` 应支持重复调用，并返回同一个关闭过程。

## 完整示例

```ts
const ciel = defineCiel({
  model,
  systemPrompt: '你是 Ciel。',
  storage,
  investigation: {
    systemPrompt: '根据检索结果回答问题，并说明信息来源。',
    tools: [searchPerceptionTimeline],
  },
});

await ciel.start();

let roomId = 'room:1000';

const session = await ciel.session({
  sessionId: 'conversation:1',
  spaceId: 'livestream',
  sources: () => [roomId],
});

const result = await ciel.investigate({
  sessionId: 'preference-query:1',
  spaceId: 'livestream',
  sources: () => [roomId],
  question: '主播以前提到过哪些明确的游戏偏好？',
});

await session.agent.prompt([
  {
    role: 'user',
    content: '请根据调查结果决定接下来聊什么',
  },
  result.answer,
]);

roomId = 'room:2000';

const nextResult = await ciel.investigate({
  spaceId: 'livestream',
  sources: () => [roomId],
  question: '这个直播间最近发生了什么？',
});

await session.agent.prompt(nextResult.answer);

await session.close();
await ciel.close();
```

## 尚未确定

- Investigation Session 是否直接复用 Session 的底层消息结构，还是只复用其生命周期语义。
- `InvestigationResult.answer` 是否只返回最终助手消息，还是返回更轻量的文本与引用结构。
- 宿主只读工具是否需要统一的来源引用协议。
- 普通 Ciel Agent 是否默认获得一个调用 `investigate()` 的内置工具。
