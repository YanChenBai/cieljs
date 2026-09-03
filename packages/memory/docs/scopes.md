# 范围与日期

Scope 决定一条记忆的归属，Layer 决定它如何跨时间组织。两者独立，不同组合共用同一组表。

## 为记忆选择范围

```ts
import type { MemoryScope } from "@cieljs/memory";

const global: MemoryScope = { type: "global" };
const space: MemoryScope = { type: "space", spaceId: "space-1" };
const anotherSpace: MemoryScope = { type: "space", spaceId: "space-2" };
```

`spaceId` 是业务层定义的不透明字符串，memory 不解析它的业务含义。空间代表一组需要共享记忆的上下文，具体边界由应用决定。同一个空间可以关联多个 session；session ID 只表示来源，不决定记忆归属。

底层用 `scope_type + scope_id` 区分范围。global 使用空的内部 ID，space 必须有非空 ID。单个数据目录表示一个 Ciel 的记忆库；多个 Ciel 使用不同数据目录。

查询必须传 `scopes`。只读当前空间用 `[space]`，允许读全局时用 `[space, global]`；空数组返回空结果，不会退化成全库查询。按 ID 读取也应用范围条件。存储 API 是受信任的应用接口，调用方负责决定可访问的 scopes；Agent 工具会固定这组范围。

global 是独立归属，不是所有空间的自动汇总。需要跨空间汇总时由上层明确选择范围和输出归属。

## 每日记忆属于哪一天？

`daily` 可以显式传 `date: "2026-09-03"`。省略时按 `occurredAt` 和存储的 `timeZone` 计算；发生时间也省略时使用当前时间。

默认时区为 `Asia/Shanghai`。例如 `2026-09-02T16:30:00Z` 在该时区归入 `2026-09-03`。数据库时间戳保存时刻，`date` 保存业务日历日期，重开或更换时区不会改写既有日期。再次打开同一目录时，应继续使用业务约定的时区。

迟到事件可以补写过去日期；查询历史日期不会受到“今天是哪天”的限制。每日可保存多条记忆，`kind: "summary"` 可用于调用方生成的日结摘要。

`long_term` 不接受日期，跨天保留；`occurredAt` 仍记录事实发生或获知的时间。

## 重试与修改

外部事件可能重复投递，使用稳定的 `dedupeKey` 可以避免同一范围内重复保存。下面假定 `store` 已打开，`scope` 为当前空间：

```ts
const memory = await store.remember({
  scope,
  layer: "daily",
  date: "2026-09-03",
  content: "约定周五整理本周的讨论记录。",
  dedupeKey: "event:agreement-42",
  sources: [{ type: "event", eventId: "agreement-42" }],
});

const updated = await store.update(memory.id, {
  scope,
  expectedRevision: memory.revision,
  content: "约定改到周六整理本周的讨论记录。",
});
```

相同键与相同内容返回已有记忆；同一个键用于不同正文、层级、日期或来源会报错。每日事件重试应使用稳定的日期或发生时间，避免跨天重试时重新归档。不同范围可以使用同一个键。

`update` 保持 scope、layer、date 不变，更新成功后递增 `revision`。并发修改同一版本只允许一次成功，其他调用需要重读再决定如何更新。当前版本号用于并发检查，不提供历史修订快照。

## 过期与遗忘

`expiresAt` 控制何时停止默认召回，与 daily/long_term 无关。它不自动物理删除正文。

```ts
await store.forget(updated.id, {
  scope,
  expectedRevision: updated.revision,
});
```

`forget` 将记忆归档并删除其检索分块和向量。默认 `get`、`list`、`search` 不再返回它。管理端可通过 `includeArchived: true` 读取正文；过期记录通过 `includeExpired: true` 查看。归档内容没有检索索引，需通过 `get/list` 查阅。

当前不提供恢复归档或物理清除的公共 API。幂等键在归档后仍保留，重复事件不会让已经遗忘的记忆重新出现。

## 保留来源

`sources` 接受三类引用：session（`sessionId`，可选 `messageId/fromSeq/toSeq`）、event（`eventId`，可选 `uri`）和 memory（`memoryId`）。消息区间必须为正整数，终点不能早于起点。

来源是引用，不是跨库外键。memory 不读取或验证外部 session 是否仍存在，删除 session 也不会自动删除相关记忆；上层回读来源时应处理记录缺失与访问权限。
