<h1 align="center">@cieljs/core</h1>

<p align="center">定义并运行 Ciel，组合普通 Session、长期 Memory 与隔离的 Investigation Agent。</p>

<p align="center">
  <a href="./docs/session.md">普通 Session</a> ·
  <a href="./docs/investigation.md">Investigation</a> ·
  <a href="./docs/sources.md">来源与身份</a> ·
  <a href="./docs/lifecycle.md">存储与生命周期</a>
</p>

`@cieljs/core` 定义一个 Ciel 运行时，内部管理三套相互独立的存储：

| 概念          | 存储             | 职责                       |
| ------------- | ---------------- | -------------------------- |
| Session       | 普通对话历史     | 保存并恢复对话的事实流水   |
| Memory        | 长期记忆         | 按需召回稳定事实与偏好     |
| Investigation | 隔离调查 Session | 只读检索并整理带来源的答案 |

`defineCiel()` 只做定义，`start()` 完成存储初始化，`close()` 统一释放资源。

## 基本使用

```ts
import { defineCiel } from '@cieljs/core';

const ciel = defineCiel({
  model,
  systemPrompt: '你是 Ciel。',
  embedding: {
    cacheDir: '.cache',
  },
  mcp: {
    enabled: true,
  },
  storage: {
    session: { dataDir: '.ciel/session' },
    memory: { dataDir: '.ciel/memory' },
    investigation: { dataDir: '.ciel/investigation' },
  },
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

`mcp.enabled` 默认为关闭。开启后，Core 会在 `start()` 时读取 `.ciel/mcp.json` 并把发现的工具注入普通 Session，在 `close()` 时统一释放 MCP。

## 普通 Session

`ciel.session()` 打开或恢复一个普通对话 Session。它保存用户、助手和工具结果消息，按 `spaceId` 隔离业务空间，是对话历史的事实流水，不等同于 Memory。详见[普通 Session](./docs/session.md)。

## Investigation

`ciel.investigate()` 每次执行一轮隔离的只读检索。默认创建新 Session，传入 `sessionId` 时显式续接此前的调查。它只读查询 Memory 与 Session，不能写入。详见[Investigation](./docs/investigation.md)。

## 来源与身份

`spaceId` 和 `sources` 均由宿主明确提供。`sources` 支持静态数组或动态函数，在每次运行和工具执行前重新读取。详见[来源与身份](./docs/sources.md)。

## 存储与生命周期

三套存储必须使用不同的 `dataDir`。`start()` 幂等，`close()` 等待进行中的 Agent 与 Investigation 完成后再释放。详见[存储与生命周期](./docs/lifecycle.md)。

Core 默认创建一个共享的 `@cieljs/embed` Qwen embedding provider，并注入普通 Session 与 Memory。`embedding.cacheDir` 可以指定本地模型缓存目录；宿主仍可分别通过 `storage.session.embedding` 和 `storage.memory.embedding` 覆盖默认 provider。Investigation Session 不建立可检索索引，因此不使用该默认 provider。

完整类型定义与设计决策见 [API 设计](./docs/api-design.md)。

## 开发

```bash
vp check
vp test --run
vp run build
```

测试使用临时目录和 Faux 模型，不连接真实模型服务。
