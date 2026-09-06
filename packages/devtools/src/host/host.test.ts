import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DevtoolsHost } from "./host.ts";
import type { TraceEntry } from "../protocol/index.ts";

const hosts: DevtoolsHost[] = [];
function host(capacity?: number) {
  const value = new DevtoolsHost(capacity);
  hosts.push(value);
  return value;
}
function entries(value: DevtoolsHost): TraceEntry[] {
  const result = value.request({ type: "snapshot" });
  if (!("entries" in result)) throw new Error("Expected snapshot");
  return result.entries;
}
afterEach(() => {
  for (const value of hosts) value.close();
  hosts.length = 0;
  vi.useRealTimers();
});

describe("DevTools 按需内容", () => {
  it("大对象、循环引用和二进制不会进入事件消息", () => {
    const value = host();
    const data: Record<string, unknown> = {
      image: { type: "image", mimeType: "image/png", data: "x".repeat(200_000) },
      buffer: new Uint8Array(10_000),
    };
    data.self = data;
    value.record("frame", data);
    const snapshot = entries(value);
    expect(JSON.stringify(snapshot).length).toBeLessThan(500);
    const id = snapshot[0]!.output!.id;
    expect(value.request({ type: "read", id, path: ["image"] })).toMatchObject({
      kind: "image",
      nextOffset: 64_000,
      total: 200_000,
    });
    expect(value.request({ type: "read", id, path: ["buffer"] })).toMatchObject({
      kind: "binary",
      nextOffset: 256,
    });
    expect(value.request({ type: "read", id, path: ["self"] })).toMatchObject({ kind: "object" });
  });

  it("每页最多 100 项，拒绝 getter 和原型访问", () => {
    const value = host();
    const getter = vi.fn(() => "secret");
    const data = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [String(index), index]),
    );
    Object.defineProperty(data, "secret", { get: getter });
    value.record("large", data);
    const id = entries(value)[0]!.output!.id;
    const page = value.request({ type: "read", id });
    expect(page).toMatchObject({ nextOffset: 100 });
    expect("items" in page && page.items).toHaveLength(100);
    expect(value.request({ type: "read", id, path: ["secret"] })).toMatchObject({
      text: "[Getter / Setter]",
    });
    expect(() => value.request({ type: "read", id, path: ["__proto__"] })).toThrow("路径");
    expect(getter).not.toHaveBeenCalled();
  });

  it("淘汰和清空视图仍可读取完整内容", () => {
    const value = host(1);
    value.record("first", { text: "one" });
    const first = entries(value)[0]!.output!.id;
    value.record("second", { text: "two" });
    expect(entries(value)).toHaveLength(1);
    expect(value.request({ type: "read", id: first })).toMatchObject({ kind: "object" });
    const second = entries(value)[0]!.output!.id;
    value.request({ type: "clear" });
    expect(value.request({ type: "read", id: second })).toMatchObject({ kind: "object" });
  });

  it("流式更新合并同一条消息，工具输入输出可追踪", () => {
    vi.useFakeTimers();
    const value = host();
    const listener = vi.fn();
    value.subscribe(listener);
    const receive = value.agentListener("room:1");
    receive({
      type: "tool_execution_start",
      toolCallId: "call:1",
      toolName: "search",
      args: { query: "主播" },
    });
    receive({
      type: "tool_execution_end",
      toolCallId: "call:1",
      toolName: "search",
      result: { found: true },
      isError: false,
    });
    vi.advanceTimersByTime(60);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(entries(value)[0]).toMatchObject({
      kind: "tool",
      status: "completed",
      input: { preview: "Object" },
      output: { preview: "Object" },
    });
  });

  it("非法分页位置在宿主边界被拒绝", () => {
    expect(() => host().request({ type: "read", id: "x", offset: -1 })).toThrow("分页");
  });
});
