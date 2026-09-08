# 内容与来源检索

## 内容检索

`search()` 只检索当前 revision 的正文：

```ts
const hits = await space.search('独立游戏', {
  mode: 'hybrid',
  limit: 8,
});
```

- `hybrid`：默认值，融合全文、trigram 和向量结果
- `full_text`：适合明确关键词
- `trigram`：适合短文本、部分匹配和轻微差异
- `vector`：适合语义相关内容，需要配置 Embedding

结果中的 `score` 用于排序，不表示概率。分数相同时按发生时间降序、ID 升序稳定排序。

默认 tokenizer 使用 `Intl.Segmenter("zh", { granularity: "word" })`，并且正文和查询共享同一个分词规则。调用者仍可通过 `MemoryManager.open({ tokenize })` 注入自定义实现；更换规则后需要执行 `rebuildIndexes()`。

## 来源检索

来源检索只搜索 `sources`，不搜索正文：

```ts
const exact = await manager.searchBySource('bilibili:room:21452505', {
  mode: 'exact',
});

const text = await manager.searchBySource('主播昵称', {
  mode: 'text',
});
```

`exact` 匹配完整 source；`text` 使用全文和 trigram；`auto` 合并两类结果且为默认值。

来源全文索引与查询使用同一个 tokenizer，支持“中文 向量”这样的多关键词查询。更换 tokenizer 后执行 `rebuildIndexes()`，会同时重建当前和历史 revision 的来源分词。

默认只搜索当前 revision。传入 `includeHistory: true` 后，结果中的 `revision` 可能是旧版本，需要使用 `getRevision()` 读取准确正文。

## 发现相关 Space

`findSpacesBySource()` 复用来源检索并按 `spaceId` 聚合：

```ts
const spaces = await manager.findSpacesBySource('主播昵称');
```

结果同时包含匹配来源和具体记忆引用。没有任何记忆的空 space 不会出现。
