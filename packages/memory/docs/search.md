# 找回记忆

搜索接收一句自然语言或关键词，返回记忆、命中片段、检索方式和融合排名。下面假定 `memory` 已绑定当前空间：

```ts
const hits = await memory.search("周五有什么安排", {
  layer: "daily",
  dateFrom: "2026-09-01",
  dateTo: "2026-09-03",
  limit: 8,
});

for (const hit of hits) {
  console.log(hit.memory.id, hit.memory.date, hit.excerpt, hit.matches);
}
```

需要跨多个 scope 搜索时，使用 manager 级入口，并明确传入允许访问的范围：

```ts
const hits = await manager.search("周五有什么安排", {
  scopes: [
    { type: "global" },
    { type: "space", spaceId: "space-1" },
    { type: "space", spaceId: "space-2" },
  ],
  limit: 8,
});
```

`manager.searchFullText/searchTrigram/searchVector` 使用相同的范围参数。空数组返回空结果；不会自动搜索数据库中的全部 scope。

`dateFrom/dateTo` 包含边界，只匹配有日期的每日记忆。需要同时搜索长期记忆时，不传日期范围，或分别查询两层。

## 三种检索方式

| 方式      | 适合查找                       | 实现                                |
| --------- | ------------------------------ | ----------------------------------- |
| `fts`     | 句内关键词、多个词共同出现     | 分词后用 PostgreSQL FTS 与 GIN 索引 |
| `trigram` | 部分文本、拼写近似、短中文子串 | `pg_trgm` 与字面 LIKE 匹配          |
| `vector`  | 意思相近但用词不同的内容       | 当前模型向量的精确余弦计算          |

scope、layer、日期、种类、有效状态都在每一路 SQL 中过滤，之后才选取候选结果。短子串不一定能高效利用 trigram 索引，数据增长后需要按真实查询测量。

每路默认取 50 个分块候选，可用 `candidateLimit` 调整。RRF 按排名融合，全文和向量权重为 1，模糊检索权重为 0.7。单路内每条记忆只计一次，最终按记忆 ID 聚合，默认返回 10 条。

`score` 是排名分数，不是可信度或相似度概率。`matches` 表示 `fts/trigram/vector` 中哪些路径命中；正文来源在 `memory.sources`。

需要诊断单路结果时，调用 `searchFullText`、`searchTrigram` 或 `searchVector`。三者返回相同结构，分数仍按排名表示。向量阈值使用 `minVectorSimilarity`，默认 0.35。

## 中文分词

默认 normalizer 做 NFKC、空白与小写规范化；默认 tokenizer 使用 Node 的 `Intl.Segmenter("zh")` 识别词边界。领域词典和人名识别效果需要按业务语料评估。

可以在 `MemoryManager.open` 中传入 `tokenize: (text) => string[]`，接入自己的中文分词器。文档与查询使用同一个 tokenizer。全文使用分词后的文本，模糊检索保留未分词的规范化文本。查询以普通文本处理，不接受原始 SQL 或 tsquery 表达式。

更换 tokenizer 或运行时分词规则后，调用 `memory.rebuildIndex()`；它只重建绑定范围内的文本分块，并为当前模型重新排入向量任务。`list` 与检索的范围语义一致，但 `list` 还支持 offset 分页，搜索只返回前 limit 条。

## 故障和取消

没有配置 Embedding 时，`search` 仍执行文本检索。向量服务失败时报告 `onIndexError` 并保留文本结果；直接调用 `searchVector` 则抛出错误。

`signal` 会传给查询 Embedding Provider，并在数据库查询前后检查取消。取消不会被当作普通向量错误吞掉；已发出的本地 SQL 不会被强制中断。
