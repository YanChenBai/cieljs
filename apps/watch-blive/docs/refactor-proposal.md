# Watch Blive / DevTools / Core 调整方案

状态：待确认公共 API，尚未实现。2026-09-06。

## 已核实的问题

- Core 的 Qwen 创建与注入已经被注释，但 `CielEmbeddingOptions` 仍然是 Qwen 配置别名。不能据此认定当前卡顿已经定位到向量推理。
- DevTools 只投影 message 与 tool 事件，没有 agent / turn 执行层级；工具调用 ID 没有暴露在记录上。
- Host 保存原始值，但容量默认 300 条，淘汰时原始值也删除。对话文本截断到 16,000 字；检查器显示属性摘要并逐层查询。
- DevTools 位于左侧侧栏，内部列表与详情使用纵向排列。
- 弹幕调用 `window.livePlayer.sendDanmaku`，把返回值没有 code 也解释为成功，尚不能证明服务器接收。

## Core API

采用用户提供的顶层形状，删除 `storage` 层及 investigation 独立 model 配置：

```ts
export type CielEmbeddingOptions = EmbeddingProvider;

export interface DefineCielOptions {
  model: Model<Api>;
  systemPrompt: string;
  session: Omit<SessionStorageOptions, 'embedding'>;
  memory: Omit<MemoryStorageOptions, 'embedding'>;
  embedding?: CielEmbeddingOptions;
  tools?: AgentTool[];
  mcp?: McpTools;
  investigation?: {
    systemPrompt?: string;
    tools?: AgentTool[];
  } & Omit<SessionManagerOptions, 'embedding'>;
}
```

`EmbeddingProvider` 复用 model-kit 的通用接口，Core 不依赖或创建 `@cieljs/embed`。省略 embedding 即关闭向量模型；应用需要时显式传入 `qwen({ cacheDir })`。共享 provider 注入 session、memory；investigation 保持不构建向量索引。外部 provider 的模型资源由创建它的应用管理，Core 关闭自身索引任务和存储。

investigation 省略时，仍允许 `investigate()`：数据库默认放在 session.dataDir 同级的 `investigation` 目录；显式提供 investigation 时必须包含 dataDir。继续检查三个数据库目录互不重叠。全部 Agent 默认使用顶层 model。

Watch Blive 默认不传 embedding；本轮先支持启动配置关闭，不增加运行途中卸载模型的复杂生命周期。

## 执行记录与完整内容

完整保留用户给出的 agent_start → turn_start → message / tool_execution → turn_end → agent_end 事件。Host 为一次 prompt 建立 runId，为每轮建立 turnId，为消息开始分配稳定 messageId；update/end 复用同一 ID。toolCallId 使用 Agent 原始值，同时关联工具调用消息和 toolResult 消息。

```ts
interface TraceEvent {
  id: string;
  sequence: number;
  sessionId: string;
  runId: string;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  timestamp: number;
  event: AgentEvent;
}
```

消息和事件保存独立快照，避免 Agent 后续修改对象污染历史。保持原始事件作为事实来源，列表与执行树是投影。run 关联独立 Agent 实例，避免同一 session 并行操作混线。探索的嵌套 Agent 用 parentRunId 关联调用方。

本轮不做内容摘要压缩，也不截断原始文本或图片。UI 分页、虚拟列表和折叠用于减少渲染；图片完整保存，按需读原图。历史记录写入 `.ciel/devtools`，UI 缓存淘汰后仍能按 ID 读取；清空视图与删除历史使用不同语义。

列表使用工具 label，详情保留原始 name、description、toolCallId；从 Agent 工具注册信息建立映射。模型显示 name，详情保留 provider / id，不暴露 API key。

## 通信与目录

用 oRPC + Zod 取代手写 request union 和业务 IPC。按安装时的 dist-tags 确认 v2 版本，再选 beta 或稳定版，并让各 oRPC 包版本一致。

Electron 使用官方 Message Port Adapter：preload 只负责可信窗口的端口交接，main 持有 router。校验 sender、frame 与端口来源，不允许直播网页连接控制 router；窗口重载时释放旧端口与订阅。浏览器端复用 DevTools router 的 WebSocket adapter。

公共方法建议：

```ts
devtools.runs.list({ cursor?, limit? })
devtools.entries.list({ runId, cursor?, limit? })
devtools.entries.get({ id })
devtools.messages.get({ messageId })
devtools.events.subscribe({ afterSequence? }) // AsyncIterable
```

snapshot / 订阅使用一致的 sequence 水位，支持重连补读，不漏掉连接期间的事件。业务 router 另设 account、watch、window 命名空间，保留现有操作语义。

DevTools 仍使用一个包，按导出隔离源码：

```text
packages/devtools/src/
  ui/          # Vue 组件、组合函数、样式；根导出
  protocol/    # Zod schema、事件和 DTO；./protocol
  host/        # 事件收集、存储、router；./host
  client/      # oRPC 客户端和订阅；./client
```

host 的 Node / Electron 依赖不能进入 UI 导出。应用的 account/watch router 位于 watch-blive，不加入通用 DevTools 包。

## 布局与扩展插槽

```text
观看设置、个人信息 | webview | DevTools
                           | 事件列表 | 详情
```

左右侧栏独立折叠、拖动调整宽度，webview 使用剩余空间。个人信息标题同行放置“退出、刷新”，退出在刷新前。Tabs 使用现有 @vuetify/v0 的 Tabs 组件。

详情同时提供可折叠的概览、输入、输出、模型返回的 reasoning、工具信息、模型信息、原始事件区块；不用输入/输出按钮互斥切换。

组件边界：Workspace 只组合侧栏、webview、DevtoolsDock；TraceList 负责选择记录，TraceDetail 负责分块展示，ContentRenderer 负责默认文本/图片/对象渲染。

```vue
<CielDevtools :client="client">
  <template #content="{ entry, section, value, defaultRenderer }">
    <CustomContent v-if="isCustom(value)" :value="value" />
    <component :is="defaultRenderer" v-else :value="value" />
  </template>
</CielDevtools>
```

插槽中的 section 为 input / output / reasoning / raw，value 是完整内容。应用可以渲染弹幕等业务内容，DevTools 提供默认渲染，避免把 Bilibili 逻辑耦合进组件。

背景拟采用中性深灰分层（底色 #18181b、面板 #202024），粉色 #FB7299 保留作交互强调。宿主与 DevTools 统一细滚动条和 hover 状态；第三方 webview 的滚动条不受宿主 CSS 控制。

## 弹幕与资源

核对旧版实现和当前网页真实输入框，使用输入事件及发送按钮路径。以明确发送响应判断 delivered；点击完成仅代表 submitted，超时或无响应不能标记已送达，也不自动重试以免重复发送。模拟模式不触发页面输入、点击或已发送历史写入。验证期间使用拦截响应，真实发言需要明确的测试内容授权。

应用生成的数据、缓存、下载模型、日志、Electron profile 与 MCP 配置统一在应用资源根 `.ciel` 下：session/、memory/、investigation/、devtools/、models/、cache/、logs/、electron/、mcp.json。打包只读图标仍属于构建资源。开发默认 cwd/.ciel，打包默认用户可写 userData 下的 .ciel；旧数据迁移需检测冲突，不能覆盖现有目标数据。

## 验证

- Core：不配置 embedding 时零模型创建；显式注入、默认 investigation 路径、目录隔离、关闭与启动失败回滚。
- DevTools：多轮执行、工具流式结果、消息 ID 关联、并发 run、完整长文本及图片、历史回读、重连水位、插槽。
- Electron：可信端口连接、重载释放、三栏 resize/collapse、Tabs 键盘导航、详情刷新。
- 弹幕：模拟零副作用，成功/拒绝/未知响应准确区分，房间切换中断；未经真实发送测试不能宣称真实送达已验证。
- 执行 vp check、vp test 及受影响包的 build / 类型检查；与既有未提交变更造成的问题分别报告。

参考：https://orpc.dev/docs/adapters/electron
