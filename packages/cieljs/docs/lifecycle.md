# 存储与生命周期

## 共享存储

宿主创建一个 Storage，注册 sessionStorage、memoryStorage 和可选的 vectorStorage、traceStorage。每个模块在自己的 PostgreSQL schema 中维护迁移版本。普通会话和调查会话通过 namespace 隔离，Memory 独立维护业务规则。

关闭顺序为 Agent / Core、TraceHost、VectorService，最后 Storage。Manager 只借用数据库，不负责关闭它。

## 启动

`defineCiel()` 只完成定义，不执行异步 I/O：

```ts
const ciel = defineCiel(options);

await ciel.start(); // 打开业务 Manager，并按配置创建 MCP
```

`start()` 幂等：运行中再次调用直接返回；重复的并发调用共享同一个启动 Promise。启动失败会逆序回收已打开的资源并回到 `idle`；如果回收也失败，`SuppressedError` 会保留初始化和清理错误。

## 状态

```ts
export type CielStatus = 'idle' | 'starting' | 'running' | 'closing' | 'closed';
```

`session()` 与 `investigate()` 只能在 `running` 状态调用；开始关闭后不再允许创建新的 Session 或 Investigation。

## 关闭

`ciel.close()` 的固定顺序：

1. 禁止创建新的 Session 与 Investigation。
2. 等待进行中的启动完成。
3. 等待所有活动 Session 与 Investigation 完成。
4. 按初始化的逆序释放 MCP、Memory、Investigation 与普通 Session 存储。

`close()` 幂等，重复调用返回同一个关闭 Promise。任一环节失败会以 `AggregateError` 汇总抛出；多个资源清理失败时，资源栈通过嵌套的 `SuppressedError` 保留错误，并继续释放剩余资源。

Ciel、CielSession、SessionManager、MemoryManager 和 MCP 都支持 `Symbol.asyncDispose`，可以使用 `await using`：

```ts
await using ciel = defineCiel(options);
await ciel.start();

await using session = await ciel.session({ spaceId: 'default' });
// 离开作用域时先关闭 Session，再关闭 Ciel。
```

SessionManager 与 MemoryManager 会先等待进行中的操作（Session 还会等待 compaction），再刷新索引并关闭数据库。即使索引刷新失败，数据库仍会被关闭；两个步骤都失败时会保留两个错误。
