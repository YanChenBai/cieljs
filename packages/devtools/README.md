# Ciel DevTools

用于 Agent 对话与工具调用检查的 Vue 面板，沿用 Watch Blive 的粉紫暗色主题。

同一个包提供四个入口，UI 不依赖 Electron，宿主不依赖 Vue：

| 入口                        | 职责                                                      |
| --------------------------- | --------------------------------------------------------- |
| `@cieljs/devtools`          | `CielDevtools` Vue 组件                                   |
| `@cieljs/devtools/host`     | `DevtoolsHost`、`attachWebSocket`，持有原始内容和事件记录 |
| `@cieljs/devtools/client`   | `createIpcTransport`、`createWebSocketTransport`          |
| `@cieljs/devtools/protocol` | 传输类型、通道名与请求校验                                |

## 观察 Agent

```ts
import { DevtoolsHost } from "@cieljs/devtools/host";

const devtools = new DevtoolsHost();
const unsubscribe = devtools.observe(session.agent, session.id);

devtools.record("frame", { image, roomId: 123 }, session.id);

// Investigation 没有长期暴露 Agent，可传入事件监听器。
await ciel.investigate({
  spaceId: "exploration",
  question: "选择下一间直播间",
  onEvent: devtools.agentListener("exploration:1"),
});

unsubscribe();
devtools.close();
```

对话视图使用 `markstream-vue`，相同消息的更新每 60ms 合并发送，显示模型实际返回的文本与 reasoning。文本摘要最多各 16,000 字符，完整内容在检查器按需读取。原始 HTML 按文本转义。

请求视图显示消息、工具和应用事件的状态与耗时；工具开始保存输入，更新或结束保存输出。错误工具标记为 `error`。`sessionId` 区分访问和探索任务。

## Electron IPC

主进程把已验证的 renderer 请求交给 `host.request(input)`，把 `host.subscribe(update)` 的更新转发给 renderer。Watch Blive 的 `src/main/ipc.ts` 和 `src/preload/index.ts` 提供完整接入，并校验发送窗口和来源地址。

```vue
<script setup lang="ts">
import { CielDevtools } from "@cieljs/devtools";
import { createIpcTransport } from "@cieljs/devtools/client";
import "@cieljs/devtools/style.css";

const transport = createIpcTransport(window.watchBlive.devtools);
</script>

<template>
  <CielDevtools :transport="transport" />
</template>
```

传输对象在组件存活期间保持稳定。组件先订阅再获取快照，并合并初始化期间的事件；卸载时移除订阅。

## WebSocket

使用标准 `send` / `addEventListener` 接口；Node 的 `ws` 连接与浏览器 `WebSocket` 均可适配。

```ts
// 服务端：连接建立且授权完成后调用。服务端地址、连接鉴权由应用负责。
import { attachWebSocket } from "@cieljs/devtools/host";
const detach = attachWebSocket(devtools, socket);

// 浏览器：在 socket 的 open 事件后创建 transport，再传给组件。
import { createWebSocketTransport } from "@cieljs/devtools/client";
const transport = createWebSocketTransport(socket);

// 卸载连接：不代替应用关闭共享 socket。
transport.close();
detach();
```

请求带递增编号，10 秒超时；连接关闭时拒绝未完成请求并移除监听。重连由应用创建新的 transport 与面板实例。

## 按需检查内容

实时事件只包含摘要和 `{ id, preview }` 引用，不传完整对象、Buffer 或 base64 图片。检查器使用 `vue-json-pretty` 虚拟列表，每页最多 100 个属性；点击值读取下一层。

- 字符串每页最多 64,000 字符。
- Buffer、TypedArray、ArrayBuffer 每页显示 256 字节的十六进制内容。
- `{ type: "image", mimeType, data }` 图片在点击加载后按块读取，生成 Blob URL；切换或卸载时释放 URL，预览上限 18MB。
- Date、Map、Set、Error、bigint、undefined 保留可检查的类型摘要，Map 和 Set 支持索引分页；循环引用逐层读取，路径最多 32 层。
- 不执行 getter，不访问继承属性和原型路径。
- 默认保留最近 300 条记录，可通过 `new DevtoolsHost(600)` 调整；淘汰或清空同时释放原始引用。记录上限不是宿主内存字节上限，调用方应避免长期持有大量高分辨率帧。

宿主保留原始值引用：传入后不要在 Agent 事件更新之外继续修改历史值。传输只承载有界 JSON，暂不引入 superjson；这里需要的是内容引用、分页与生命周期，而非在每个 token 上序列化完整对象。

## 验证

```sh
vp run --filter @cieljs/devtools build
vp test packages/devtools/src
vp run --filter watch-blive build
```
