import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { afterEach, expect, it } from "vite-plus/test";
import { RPCHandler } from "@orpc/server/message-port";
import { RPCLink } from "@orpc/client/message-port";
import { createORPCClient } from "@orpc/client";
import type { RouterClient } from "@orpc/server";
import { DevtoolsHost } from "./host.ts";
import { createDevtoolsRouter } from "./router.ts";
import type { TraceEvent, TraceEntry } from "../protocol/index.ts";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

it("完整保存多轮事件、稳定消息 ID 和 toolCallId，快照不随原对象变化", async () => {
  const host = new DevtoolsHost();
  cleanup.push(() => host.close());
  const receive = host.agentListener("session");
  const message = {
    role: "user" as const,
    content: [{ type: "text" as const, text: "x".repeat(20000) }],
    timestamp: 0,
  };
  receive({ type: "agent_start" });
  receive({ type: "turn_start" });
  receive({ type: "message_start", message });
  receive({ type: "message_end", message });
  receive({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "search",
    args: { text: "hello" },
  });
  receive({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "search",
    result: { content: [{ type: "text", text: "result" }] },
    isError: false,
  });
  receive({ type: "turn_end", message, toolResults: [] });
  receive({ type: "turn_start" });
  receive({ type: "message_start", message });
  receive({ type: "message_end", message });
  receive({ type: "turn_end", message, toolResults: [] });
  receive({ type: "agent_end", messages: [message] });
  message.content = [];
  const events = host.store.list<TraceEvent>("event", { ascending: true });
  expect(events.map((item) => item.event.type)).toEqual([
    "agent_start",
    "turn_start",
    "message_start",
    "message_end",
    "tool_execution_start",
    "tool_execution_end",
    "turn_end",
    "turn_start",
    "message_start",
    "message_end",
    "turn_end",
    "agent_end",
  ]);
  expect(new Set(events.map((item) => item.runId)).size).toBe(1);
  expect(events[2]!.messageId).toBe(events[3]!.messageId);
  expect(events[2]!.turnId).not.toBe(events[8]!.turnId);
  expect(events[4]!.toolCallId).toBe("call-1");
  const entries = host.store.list<TraceEntry>("entry");
  expect(entries.find((entry) => entry.kind === "message")!.text).toHaveLength(20000);
  expect(host.store.get(`${events[2]!.messageId}:output`)).toMatchObject({
    content: [{ text: "x".repeat(20000) }],
  });
  const controller = new AbortController();
  const stream = host.events(events[10]!.sequence, controller.signal);
  expect((await stream.next()).value?.event.type).toBe("agent_end");
  const pending = stream.next();
  controller.abort();
  expect((await pending).done).toBe(true);
});

it("淘汰后与宿主重启后均可按 ID 回读原始图片", () => {
  const directory = mkdtempSync(join(tmpdir(), "ciel-trace-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const host = new DevtoolsHost(1, directory);
  host.record("image", { type: "image", mimeType: "image/png", data: "a".repeat(100000) });
  const entry = host.store.list<TraceEntry>("entry")[0]!;
  host.record("next", "hello");
  host.close();
  const reopened = new DevtoolsHost(1, directory);
  cleanup.push(() => reopened.close());
  expect(reopened.store.get(entry.output!.id)).toMatchObject({ data: "a".repeat(100000) });
});

it("oRPC MessagePort 可读取完整内容和取消更新订阅", async () => {
  const host = new DevtoolsHost();
  cleanup.push(() => host.close());
  const router = createDevtoolsRouter(host);
  const handler = new RPCHandler(router);
  const channel = new MessageChannel();
  cleanup.push(() => {
    channel.port1.close();
    channel.port2.close();
  });
  handler.upgrade(channel.port1);
  channel.port1.start();
  channel.port2.start();
  const client: RouterClient<typeof router> = createORPCClient(
    new RPCLink({ port: channel.port2 }),
  );
  host.record("hello", "完整输出");
  const entries = await client.entries.list({ limit: 10 });
  expect(await client.values.get({ id: entries[0]!.output!.id })).toBe("完整输出");
  const controller = new AbortController();
  const stream = await client.updates(undefined, { signal: controller.signal });
  expect((await stream.next()).value?.entries).toHaveLength(1);
  controller.abort();
  await stream.return?.();
  await handler.close(channel.port1);
});
