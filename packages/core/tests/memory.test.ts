import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { MemoryManager } from "@cieljs/memory";
import { createMemoryIntegration } from "../src/memory.ts";

let manager: MemoryManager;
beforeAll(async () => {
  manager = await MemoryManager.open({ dataDir: "memory://" });
}, 30000);
afterAll(async () => {
  await manager?.close();
});

test("不同 session 共享 space，召回只进入模型上下文且每次刷新", async () => {
  const scope = { type: "space" as const, spaceId: "live:123" };
  const memory = manager.memory(scope, { includeGlobal: false });
  const first = createMemoryIntegration({ memory, allowWrite: true, maxTokens: 5000 }, "session-1");
  const second = createMemoryIntegration({ memory, maxTokens: 5000 }, "session-2");
  await first.tools
    .find((tool) => tool.name === "remember_memory")!
    .execute("w", {
      content: "观众喜欢恐怖游戏",
      layer: "long_term",
    });
  const messages: AgentMessage[] = [{ role: "user", content: "观众喜欢什么", timestamp: 1 }];
  const transformed = await second.transformContext(messages);
  expect(messages).toHaveLength(1);
  expect(transformed).toHaveLength(2);
  expect(JSON.stringify(transformed[0])).toContain("session-1");
  expect(JSON.stringify(transformed[0])).toContain("恐怖游戏");
  const [stored] = await memory.list();
  await memory.forget(stored!.id, { expectedRevision: 1 });
  expect(await second.transformContext(messages)).toBe(messages);
});

test("禁用全局记忆时工具与自动上下文使用相同范围", async () => {
  await manager.memory({ type: "global" }).remember({ layer: "long_term", content: "global-only" });
  const integration = createMemoryIntegration(
    {
      memory: manager.memory({ type: "space", spaceId: "isolated" }, { includeGlobal: false }),
    },
    "s",
  );
  const messages: AgentMessage[] = [{ role: "user", content: "global-only", timestamp: 1 }];
  expect(await integration.transformContext(messages)).toBe(messages);
  const result = await integration.tools
    .find((tool) => tool.name === "search_memory")!
    .execute("s", { query: "global-only" });
  expect(result.details).toEqual({ hits: [] });
});
