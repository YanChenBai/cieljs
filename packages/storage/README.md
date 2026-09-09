# @cieljs/storage

一个 Storage 拥有一个 PGlite / Drizzle 实例。Session、Memory、Vector 和 DevTools 注册各自的模块，并在独立 PostgreSQL schema 中存储数据。公共 Pi 运行记录位于 `storage.events`。

```ts
import { Storage } from '@cieljs/storage';
import { SessionManager, sessionStorage } from '@cieljs/session';
import { MemoryManager, memoryStorage } from '@cieljs/memory';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage, memoryStorage],
});
await using sessions = await SessionManager.open({ storage, namespace: 'session' });
await using memory = await MemoryManager.open({ storage });
```

模块的 `id` 同时是 schema 名称；`migrations` 按声明顺序执行，每个模块有独立的 `__migrations` 表。迁移在事务中提交，已经应用的 SQL 不允许修改。新数据库直接使用当前基线，不导入旧数据库。

所有借用 Storage 的服务必须先关闭。关闭 Manager 或 DevTools 不关闭数据库，宿主最后关闭 Storage。初始化失败会回收 PGlite。

`storage.journal` 直接接受 Pi `AgentEvent`，在消息生成时分配统一的关联 ID。Session 将消息关联投影与事件写入放入同一事务，消息正文通过视图读取。重复提交同一事件对象不会重复追加事件。

记录保留 Pi 的事件快照，不执行重新生成。当前保留完整流式事件，未启用历史保留策略或压缩。
