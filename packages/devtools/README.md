# @cieljs/devtools

Agent 执行记录、对话和原始内容检查器。宿主负责采集与 PGlite 快照；oRPC router 提供查询与可取消订阅；Vue 面板接收类型化 client。

## 接入

应用选择 oRPC 适配器，负责连接、鉴权和释放。包内不再提供 IPC/WebSocket 私有协议或适配器工厂。

```ts
// 宿主：router 可挂到应用已有的 oRPC router 下。
import { DevtoolsHost, createDevtoolsRouter } from '@cieljs/devtools/host';
import { RPCHandler } from '@orpc/server/message-port';

import { Storage } from '@cieljs/storage';
import { devtoolsStorage } from '@cieljs/devtools/host';

await using storage = await Storage.open({ dataDir: './data/storage', modules: [devtoolsStorage] });
await using host = await DevtoolsHost.open({ storage, capacity: 300 });
const router = createDevtoolsRouter(host);
const handler = new RPCHandler(router);
handler.upgrade(serverPort);
serverPort.start();

// 客户端：适配器由应用创建，也可换成 oRPC WebSocket / Fetch link。
import { RPCLink } from '@orpc/client/message-port';
import { createDevtoolsClient } from '@cieljs/devtools/client';

clientPort.start();
const client = createDevtoolsClient(new RPCLink({ port: clientPort }));
```

```vue
<script setup lang="ts">
import { CielDevtools } from '@cieljs/devtools';
import type { DevtoolsClient } from '@cieljs/devtools/client';
import '@cieljs/devtools/style.css';
defineProps<{ client: DevtoolsClient }>();
</script>
<template><CielDevtools :client="client" /></template>
```

嵌套路由可直接传入应用 client 的 devtools 分支；watch-blive 的 main/application.ts、main/ipc.ts 与 renderer/src/rpc.ts 展示了 Electron 接入方式。client 在面板存活期间保持稳定。

## 自定义工具渲染

同一次工具调用只渲染一个块：assistant 消息里的 `toolCall` 块承担参数与结果，对应的 `toolResult` 消息不再单独成卡片（只有工具条目缺失或来源消息不在窗口内时才保留卡片）。面板按工具机器名挑选宿主提供的组件替换该块的正文：

```vue
<script setup lang="ts">
import type { ToolRenderers } from '@cieljs/devtools';

import SendDanmakuToolCall from './components/SendDanmakuToolCall.vue';

// 用普通常量或 markRaw，放进 reactive 会让 Vue 代理组件对象。
const toolRenderers: ToolRenderers = { send_danmaku: SendDanmakuToolCall };
</script>
<template><CielDevtools :client="client" :tool-renderers="toolRenderers" /></template>
```

组件用 `defineProps<ToolRendererProps>()` 声明契约，只负责展示：

| 字段                             | 说明                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| `name` / `label` / `description` | 工具机器名、标签与描述                                      |
| `status`                         | 工具执行状态：`running` / `completed` / `error`             |
| `toolCallId`                     | 调用 ID，可用于「执行记录」里对照                           |
| `args`                           | 调用参数，与工具条目的输入同源                              |
| `result`                         | 工具原始返回 `{ content, details }`，未取到时为 `undefined` |
| `loading` / `loadError`          | DevTools 取值状态；`loadError` 不是工具执行失败             |

未匹配到渲染器的工具走默认正文（描述 + 参数 + 结果），参数与结果按文本或 JSON 展示。标题、状态和折叠行为始终由 DevTools 渲染，渲染器只替换折叠后的正文；渲染器保持简单即可，Vue 没有内置错误边界，抛错会冒泡到面板。完整示例见 watch-blive 的 `renderer/src/components/SendDanmakuToolCall.vue`（列表类结果见 `StreamerHistoryToolCall.vue`）。

## 自定义消息渲染

对话里的消息默认按 Markdown / 图片渲染。结构化输出的 assistant 消息（整串就是 JSON）原本会退化成代码块，宿主可以用 `messageRenderers` 把认得出的内容换成自己的说法：

```vue
<script setup lang="ts">
import type { MessageRenderers } from '@cieljs/devtools';

import RoomDecisionMessage from './components/RoomDecisionMessage.vue';

const isRoomDecision = (json: unknown): boolean =>
  typeof json === 'object' && json !== null && 'action' in json && 'score' in json;

const messageRenderers: MessageRenderers = [
  {
    match: message => message.name === 'assistant' && isRoomDecision(message.json),
    component: RoomDecisionMessage,
  },
];
</script>
<template><CielDevtools :client="client" :message-renderers="messageRenderers" /></template>
```

渲染器同样只收纯数据：

| 字段               | 说明                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| `name` / `label`   | 消息角色与条目标签（感知条目是「视频语音 · 1:20」这类）               |
| `text`             | 消息原始文本，没有文本时为空串                                        |
| `json`             | 只在整串文本本身就是 JSON 对象/数组时给出解析结果，其余为 `undefined` |
| `model` / `status` | 生成模型与条目状态                                                    |

用「谓词 + 组件」而不是按角色索引：一条 assistant 消息既可能是结构化输出也可能是普通回复，`match` 返回 `false` 就继续找下一个渲染器，最后走默认渲染。命中的渲染器优先于 `#content` 插槽（面板总会填这个插槽），因此渲染器必须自己保证只在真正认得内容时才命中。`messageRenderers` 与 `toolRenderers` 一样用普通常量或 `markRaw`。

## 数据与生命周期

- `host.observe(agent, sessionId)` 返回取消观察函数；`host.agentListener(sessionId)` 可直接接收 Agent 事件。
- `host.record(name, output, sessionId)` 保存应用事件。
- `entries/steps/runs.list` 使用序号游标分页；`values.get` 按引用读取完整内容。路径不会执行 getter 或读取继承属性。
- `updates` 先返回快照再推送批量变更；`events.subscribe` 支持从指定原始事件序号继续读取。
- `updates` 同时推送 `usage`：`total` 是累计消耗（按 `message_end` 一次计数，含缓存读取与写入），`context` 是最近一次请求的用量。二者都由宿主重放存储得到，与「执行记录」的历史同源，因此不依赖客户端加载到哪些记录，清空视图也不会重置。
- 切换详情时取消旧请求，仅加载当前标签页。UI 清空只隐藏已有记录，PGlite 历史仍可通过 API 查询。
- 执行列表按运行、轮次、消息和工具调用合并开始／更新／结束事件，工具结果消息并入对应调用。失败项标红，Inspect 概览展示错误载荷；原始事件标签可逐个查看合并前的快照。
- 内存摘要默认保留 300 条，磁盘记录不会随淘汰删除。宿主保存独立快照，后续修改原对象不影响历史。
- 关闭时应用先取消观察、关闭 oRPC 连接，再调用 `host.close()`。宿主关闭也会结束等待中的订阅。

迁移：移除 `DevtoolsTransport`、`DevtoolsRequest`、`host.request` 与旧传输工厂的使用，改用 router/client。旧分页值协议已删除；完整内容通过 oRPC 适配器序列化，特殊对象支持以所选适配器为准。

## 验证

```sh
vp test packages/devtools/src
vp run --filter @cieljs/devtools build
```

## 共享存储与独立使用

```ts
import { Storage } from '@cieljs/storage';
import { DevtoolsHost, devtoolsStorage } from '@cieljs/devtools/host';

await using storage = await Storage.open({ dataDir: '.ciel/storage', modules: [devtoolsStorage] });
await using host = await DevtoolsHost.open({ storage });
const unsubscribe = host.observe(agent, 'session-id');
await agent.prompt('你好');
await host.flushRecords();
unsubscribe();
```

DevTools 不依赖 Session 或 Core，直接消费 Pi 运行记录协议。与 Session 共享同一个 Storage 时，消息正文引用公共事件，不再写入 PGlite。宿主重启时从公共记录重放投影，记录 ID 保持稳定；当前采用完整重放，启动成本随事件数增长。

Host 和 store 的查询均为异步；关闭 Host 后再关闭 Storage。
