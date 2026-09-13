<h1 align="center">@cieljs/runtime</h1>

<p align="center">执行 Ciel Session 与 Investigation 的底层运行引擎。</p>

`Runtime` 只管理运行状态、Agent、Session 和 Investigation 生命周期。它不解析目录，不创建 Storage、SessionManager、MemoryManager 或 MCP，也不提供 `defineCiel()`。

应用通常应使用顶层 [`cieljs`](../cieljs/README.md)；只有需要自行组合所有 Manager 时才直接实例化 Runtime：

```ts
import { Runtime } from '@cieljs/runtime';

const runtime = new Runtime({
  model,
  systemPrompt: '你是 Ciel。',
  sessionManager,
  investigationManager,
  memoryManager,
  tools,
});

await runtime.start();
```

传入的 Manager 由调用方持有，`Runtime.close()` 只结束自身打开的 Agent、Session 和 Investigation，不关闭这些共享实例。
