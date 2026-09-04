import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { MemoryManager } from "@cieljs/memory";
import { createMemory } from "../src/memory.ts";

let manager: MemoryManager;

beforeAll(async () => {
  manager = await MemoryManager.open({ dataDir: "memory://" });
}, 30000);

afterAll(async () => {
  await manager?.close();
});

test("长期记忆进入系统提示词，每日记忆只进入当前调用", async () => {
  const spaceId = "space-1";
  const space = manager.space(spaceId);
  await manager.global.longTerm.remember({ content: "global-long-term" });
  await space.longTerm.remember({ content: "space-long-term" });
  await space.daily.remember({ content: "space-daily" });

  const integration = await createMemory({ space, maxTokens: 5000 }, "session-1");
  const messages: AgentMessage[] = [{ role: "user", content: "现在呢", timestamp: 1 }];
  const transformed = await integration.transformContext(messages);

  expect(integration.systemPrompt).toContain("global-long-term");
  expect(integration.systemPrompt).toContain("space-long-term");
  expect(integration.systemPrompt).not.toContain("space-daily");
  expect(messages).toHaveLength(1);
  expect(transformed).toHaveLength(2);
  expect(JSON.stringify(transformed[0])).toContain("space-daily");
});

test("写入固定归属当前空间，跨空间读取需要显式授权", async () => {
  const spaceId = "allowed";
  const space = manager.space(spaceId);
  const otherLongTerm = await manager
    .space("other")
    .longTerm.remember({ content: "other-long-term" });
  const integration = await createMemory(
    { space, crossSpaceSearch: true, maxTokens: 5000 },
    "session-2",
  );

  await integration.tools
    .find((tool) => tool.name === "remember_memory")!
    .execute("write", { content: "current-space-daily", layer: "space.daily" });
  const current = [...(await space.daily.list()), ...(await space.longTerm.list())];
  const result = await integration.tools
    .find((tool) => tool.name === "search_all_memory")!
    .execute("search", { query: "other-long-term" });
  const hits = (result.details as { hits: Array<{ memory: { id: string } }> }).hits;

  expect(current.map((entry) => entry.content)).toContain("current-space-daily");
  expect(current[0]?.sources).toEqual([{ type: "session", sessionId: "session-2" }]);
  expect(hits.map((hit) => hit.memory.id)).toContain(otherLongTerm.id);
});
