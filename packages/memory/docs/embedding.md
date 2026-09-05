# 向量检索

Embedding 配置与 `@cieljs/agent-kit` 共用：

```ts
const manager = await MemoryManager.open({
  dataDir: ".ciel/memory",
  embedding: {
    model: "text-embedding-model",
    dimensions: 1024,
    embedBatch,
  },
});
```

正文写入和 revision 更新在事务提交后即可被普通读取、全文检索和来源检索看到。向量任务异步执行：

```ts
await manager.flushIndexes();
const hits = await space.search("相关含义", { mode: "vector" });
```

- `getIndexStatus()` 查看 pending、ready 和 failed 数量
- `flushIndexes()` 等待已排入的任务结束
- `retryIndexes()` 重试失败任务
- `rebuildIndexes()` 重建当前 revision 的正文 chunk 和向量任务

Chunk ID 每次更新都会更换，旧向量任务无法写回新 revision。没有配置 Embedding 时，`vector` 返回空结果，`hybrid` 仍使用全文和 trigram。
