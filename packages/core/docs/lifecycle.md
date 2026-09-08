# 存储与生命周期

## 三套存储

一个 Ciel 运行时管理三套相互独立的存储：

```text
Session        ── 普通对话历史，会恢复到后续上下文
Memory         ── 长期记忆，会按需召回
Investigation  ── 隔离调查 Session，默认新建并可显式恢复
```

推荐目录：

```text
.ciel/
├── session/
├── memory/
└── investigation/
```

三个 `dataDir` 必须不同。`defineCiel()` 会同步拒绝普通 Session 与 Investigation 共用同一套消息存储。

## 启动

`defineCiel()` 只完成定义，不执行异步 I/O：

```ts
const ciel = defineCiel(options);

await ciel.start(); // 初始化三套存储，并按配置创建 MCP
```

`start()` 幂等：运行中再次调用直接返回；重复的并发调用共享同一个启动 Promise。启动失败会回滚已打开的存储并回到 `idle`。

## 状态

```ts
export type CielStatus = 'idle' | 'starting' | 'running' | 'closing' | 'closed';
```

`session()` 与 `investigate()` 只能在 `running` 状态调用；开始关闭后不再允许创建新的 Session 或 Investigation。

## 关闭

`ciel.close()` 的固定顺序：

1. 等待进行中的启动完成。
2. 禁止创建新的 Session 与 Investigation。
3. 等待所有活动 Session 与 Investigation 完成。
4. 关闭普通 Session、Investigation 与 Memory 存储，并释放 MCP。

`close()` 幂等，重复调用返回同一个关闭 Promise。任一环节失败会以 `AggregateError` 汇总抛出。
