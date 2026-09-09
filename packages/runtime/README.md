<h1 align="center">@cieljs/runtime</h1>

<p align="center">定义并运行 Ciel，组合普通 Session、长期 Memory 与隔离的 Investigation Agent。</p>

<p align="center">
  <a href="./docs/session.md">普通 Session</a> ·
  <a href="./docs/investigation.md">Investigation</a> ·
  <a href="./docs/sources.md">来源与身份</a> ·
  <a href="./docs/lifecycle.md">存储与生命周期</a>
</p>

`@cieljs/runtime` 定义一个 Ciel 运行时，在共享 Storage 上管理三个业务入口：

| 概念          | 存储             | 职责                       |
| ------------- | ---------------- | -------------------------- |
| Session       | 普通对话历史     | 保存并恢复对话的事实流水   |
| Memory        | 长期记忆         | 按需召回稳定事实与偏好     |
| Investigation | 隔离调查 Session | 只读检索并整理带来源的答案 |

`defineCiel()` 只做定义，`start()` 打开业务 Manager，`close()` 释放运行任务；宿主负责最后关闭共享 Storage。

## 基本使用

```ts
import { Storage } from '@cieljs/storage';
import { sessionStorage } from '@cieljs/session';
import { memoryStorage } from '@cieljs/memory';
import { VectorService, vectorStorage } from '@cieljs/vector';
import { defineCiel } from '@cieljs/runtime';
import { createMcp } from '@cieljs/mcp';

await using mcp = await createMcp();

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage, memoryStorage, vectorStorage],
});

const ciel = defineCiel({
  model,
  systemPrompt: '你是 Ciel。',
  mcp,
  storage,
});

await ciel.start();

let roomId = 'room:1000';

const session = await ciel.session({
  spaceId: 'livestream',
  sources: () => [roomId],
});

await session.agent.prompt('你好');

const result = await ciel.investigate({
  spaceId: 'livestream',
  sources: () => [roomId],
  question: '主播以前提到过哪些游戏偏好？',
});

await session.agent.prompt(result.answer);

await session.close();
await ciel.close();
```

MCP 由宿主创建并通过 `mcp` 注入。runtime 借用实例，关闭时不释放 MCP；宿主在全部 runtime 关闭后释放共享实例。

## 普通 Session

`ciel.session()` 打开或恢复一个普通对话 Session。它保存用户、助手和工具结果消息，按 `spaceId` 隔离业务空间，是对话历史的事实流水，不等同于 Memory。详见[普通 Session](./docs/session.md)。

## Investigation

`ciel.investigate()` 每次执行一轮隔离的只读检索。默认创建新 Session，传入 `sessionId` 时显式续接此前的调查。它只读查询 Memory 与 Session，不能写入。详见[Investigation](./docs/investigation.md)。

## 来源与身份

`spaceId` 和 `sources` 均由宿主明确提供。`sources` 支持静态数组或动态函数，在每次运行和工具执行前重新读取。详见[来源与身份](./docs/sources.md)。

## 存储与生命周期

Session、Memory 和 Vector 使用一个 PGlite 的不同 schema；Investigation 使用 session schema 中的独立 namespace。`start()` 幂等，`close()` 等待进行中的 Agent 与 Investigation 完成后再释放。详见[存储与生命周期](./docs/lifecycle.md)。

向量服务由宿主显式创建并通过 `vectors` 注入。Session 和 Memory 共用计算缓存，Investigation 默认不建立向量索引。详见 [`@cieljs/vector`](../vector/README.md)。

完整类型定义与设计决策见 [API 设计](./docs/api-design.md)。

## 开发

```bash
vp check
vp test --run
vp run build
```

测试使用临时目录和 Faux 模型，不连接真实模型服务。
