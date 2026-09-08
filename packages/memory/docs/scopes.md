# 层级、版本与生命周期

## 严格层级

`manager.global` 只访问 `global.long_term`。`manager.space(spaceId)` 返回绑定空间的对象，其中 `longTerm` 和 `daily` 分别固定写入对应层级。

```ts
const space = manager.space('space-1');

await space.longTerm.remember({ content: '空间内稳定成立的事实' });
await space.daily.remember({ content: '今天发生的事件' });
```

`space.get()`、`space.list()` 和 `space.search()` 只访问当前 space，不包含全局记忆，也不会访问其他 space。

## Daily 日期

每日记忆可以显式传入 `YYYY-MM-DD` 日期。省略日期时，包先使用 `occurredAt`，再按 `MemoryManager` 的 `timeZone` 计算日期。长期记忆不能传日期。

## Revision

一条逻辑记忆拥有稳定 ID。每次更新都会保存一份完整 revision 快照，并把逻辑记忆的 current revision 指向新版本。

```ts
const updated = await space.update(memory.id, {
  expectedRevision: memory.revision,
  kind: 'preference',
  content: '更新后的完整正文',
});
```

没有提交的字段继承当前 revision。显式提交 `sources` 时会整体替换对应值。`expectedRevision` 用于阻止并发更新静默覆盖；冲突时应重新读取最新内容后再判断。

## 遗忘

`forget()` 把记忆标记为 `archived`，并从默认读取和检索中移除。历史 revision 仍可通过 `history()` 和 `getRevision()` 读取。第一版不提供物理删除和恢复 API。

归档保留正文与向量索引。宿主显式传入 `includeArchived: true` 时仍可搜索，默认 Agent 工具不会读取归档记忆。
