# @cieljs/devtools

Agent 执行记录、对话和原始内容检查器。宿主负责采集与 SQLite 快照；oRPC router 提供查询与可取消订阅；Vue 面板接收类型化 client。

## 接入

应用选择 oRPC 适配器，负责连接、鉴权和释放。包内不再提供 IPC/WebSocket 私有协议或适配器工厂。

```ts
// 宿主：router 可挂到应用已有的 oRPC router 下。
import { DevtoolsHost, createDevtoolsRouter } from '@cieljs/devtools/host';
import { RPCHandler } from '@orpc/server/message-port';

const host = new DevtoolsHost(300, './data/devtools');
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

嵌套路由可直接传入应用 client 的 devtools 分支；watch-blive 的 main/router.ts、main/ipc.ts 与 renderer/src/rpc.ts 展示了 Electron 接入方式。client 在面板存活期间保持稳定。

## 数据与生命周期

- `host.observe(agent, sessionId)` 返回取消观察函数；`host.agentListener(sessionId)` 可直接接收 Agent 事件。
- `host.record(name, output, sessionId)` 保存应用事件。
- `entries/steps/runs.list` 使用序号游标分页；`values.get` 按引用读取完整内容。路径不会执行 getter 或读取继承属性。
- `updates` 先返回快照再推送批量变更；`events.subscribe` 支持从指定原始事件序号继续读取。
- 切换详情时取消旧请求，仅加载当前标签页。UI 清空只隐藏已有记录，SQLite 历史仍可通过 API 查询。
- 内存摘要默认保留 300 条，磁盘记录不会随淘汰删除。宿主保存独立快照，后续修改原对象不影响历史。
- 关闭时应用先取消观察、关闭 oRPC 连接，再调用 `host.close()`。宿主关闭也会结束等待中的订阅。

迁移：移除 `DevtoolsTransport`、`DevtoolsRequest`、`host.request` 与旧传输工厂的使用，改用 router/client。旧分页值协议已删除；完整内容通过 oRPC 适配器序列化，特殊对象支持以所选适配器为准。

## 验证

```sh
vp test packages/devtools/src
vp run --filter @cieljs/devtools build
```
