# 记忆检索

空间入口搜索当前记忆环境：全局长期记忆，以及当前空间的长期和每日记忆。

```ts
const space = manager.space("space-1");
const hits = await space.search("之前决定如何保存历史记录");
```

需要跨所有空间搜索时直接使用 manager：

```ts
const hits = await manager.search("之前决定如何保存历史记录");
```

全库搜索始终覆盖 `global.long_term`、所有 `space.long_term` 和所有 `space.daily`，不接受 space 列表。`manager.get(id)` 使用相同的全库读取语义。

可以按复合层级过滤：

```ts
const hits = await manager.search("今天讨论了什么", {
  layer: "space.daily",
  dateFrom: "2026-09-01",
  dateTo: "2026-09-04",
});
```

`searchFullText`、`searchTrigram` 和 `searchVector` 使用相同范围规则。`dateFrom/dateTo` 包含边界，通常与 `space.daily` 一起使用。

混合搜索并行执行全文、模糊和可选向量检索，再通过 RRF 合并排名。向量服务失败时仍返回全文与模糊结果。
