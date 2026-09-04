# 层级与日期

记忆归属直接编码在 `layer` 中，不再由独立的 scope 类型与 layer 两次组合。

```ts
const space = manager.space("space-1");

await manager.global.longTerm.remember({ content: "跨空间成立的稳定事实" });
await space.longTerm.remember({ content: "当前空间的长期知识" });
await space.daily.remember({ content: "当前空间今天发生的事" });
```

数据库中的合法组合只有：

| `layer`            | `spaceId` | `date` |
| ------------------ | --------- | ------ |
| `global.long_term` | `null`    | `null` |
| `space.long_term`  | 非空      | `null` |
| `space.daily`      | 非空      | 非空   |

`global.long_term` 不属于任何 space。两个 space layer 必须带有非空 `spaceId`。`spaceId` 是业务层定义的不透明字符串，memory 不解析其含义。

## 每日记忆

`space.daily.remember()` 可以显式传 `date: "2026-09-04"`。省略时，memory 根据 `occurredAt` 和存储配置的 `timeZone` 计算日期；两者都省略时使用当前时间。

```ts
await space.daily.remember({
  content: "约定周五整理讨论记录。",
  date: "2026-09-04",
  sources: [{ type: "event", eventId: "agreement-42" }],
});
```

默认时区为 `Asia/Shanghai`。每日记忆不会在零点自动删除，`daily` 只表示按日期组织；过期由 `expiresAt` 单独控制。

长期记忆没有日期参数。事实发生或获知的时刻仍可通过 `occurredAt` 保存。

## 追加、修改与归档

`remember()` 默认追加记录，不根据正文猜测两个事件是否相同。外部 `eventId` 和 session 来源用于追溯，不承担语义去重。

需要修改已有事实时使用明确的记忆 ID 和版本号：

```ts
const updated = await space.longTerm.update(saved.id, {
  expectedRevision: saved.revision,
  content: "更新后的长期事实。",
});

await space.longTerm.forget(updated.id, {
  expectedRevision: updated.revision,
});
```

并发修改同一版本只允许一次成功。归档后，默认读取和检索不再返回该记录；正文与来源仍可供管理端查阅。

## 来源

`sources` 接受 session、event 和 memory 三类引用。来源是追溯信息，不是跨库外键。删除外部 session 或事件不会自动删除记忆。
