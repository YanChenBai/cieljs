import { randomUUID } from "node:crypto";
import { TraceStore } from "./store.ts";
import type { TraceEvent } from "../protocol/index.ts";
import type { Agent, AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import {
  parseRequest,
  type DevtoolsResponse,
  type DevtoolsUpdate,
  type TraceEntry,
  type ValuePage,
  type ValueRef,
} from "../protocol/index.ts";

/** 宿主保存独立的完整快照；内存列表淘汰不删除磁盘记录。 */
export class DevtoolsHost {
  private readonly entries = new Map<string, TraceEntry>();
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Set<(update: DevtoolsUpdate) => void>();
  private readonly dirty = new Set<string>();
  private readonly stepChanges = new Map<string, TraceEntry>();
  private readonly removed = new Set<string>();
  private sequence = 0;
  readonly store: TraceStore;
  private eventSequence = 0;
  private readonly wakeListeners = new Set<() => void>();
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly capacity = 300,
    directory?: string,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("capacity 必须是正整数");
    this.store = new TraceStore(directory);
    this.eventSequence = this.store.sequence;
    this.sequence = this.eventSequence;
  }

  subscribe(listener: (update: DevtoolsUpdate) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  request(input: unknown): DevtoolsResponse {
    const request = parseRequest(input);
    if (request.type === "snapshot") return { entries: [...this.entries.values()] };
    if (request.type === "clear") {
      for (const id of this.entries.keys()) this.removed.add(id);
      this.entries.clear();
      this.values.clear();
      this.dirty.clear();
      this.flush();
      return { cleared: true };
    }
    let value = this.values.get(request.id) ?? this.store.get(request.id);
    if (value === undefined) throw new Error("内容不存在");
    for (const key of request.path ?? []) {
      if (!value || typeof value !== "object") throw new Error("内容路径不存在");
      if (value instanceof Map || value instanceof Set) {
        if (!/^\d+$/.test(key) || Number(key) >= value.size) throw new Error("集合索引不存在");
        const iterator = value instanceof Map ? value.entries() : value.values();
        for (let index = 0; index <= Number(key); index++) value = iterator.next().value;
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw new Error("不读取 getter 或继承属性");
      value = descriptor.value;
    }
    return readValue(value, request.offset ?? 0);
  }

  record(name: string, output: unknown, sessionId = "watch-blive") {
    const entry = this.create(sessionId, "event", name);
    entry.status = "completed";
    entry.endedAt = Date.now();
    entry.output = this.storeValue(`${entry.id}:output`, output);
    this.update(entry);
  }

  observe(agent: Pick<Agent, "subscribe" | "state">, sessionId: string) {
    const receive = this.agentListener(sessionId, () => ({
      tools: agent.state.tools,
      model: agent.state.model,
    }));
    return agent.subscribe((event) => receive(event));
  }

  agentListener(
    sessionId: string,
    metadata?: () => {
      tools?: Agent["state"]["tools"];
      model?: Agent["state"]["model"];
      parentRunId?: string;
    },
  ): (
    event: AgentEvent,
    context?: { tools: Agent["state"]["tools"]; model: Agent["state"]["model"] },
  ) => void {
    let runId = randomUUID();
    let turnId: string | undefined;
    let run: TraceEntry | undefined;
    let turn: TraceEntry | undefined;
    let message: TraceEntry | undefined;
    const tools = new Map<string, TraceEntry>();
    const callMessages = new Map<string, string>();
    return (event, context) => {
      const meta = { ...metadata?.(), ...context };
      if (event.type === "agent_start") {
        runId = randomUUID();
        turnId = undefined;
        callMessages.clear();
      }
      if (event.type === "turn_start") turnId = randomUUID();
      const eventSequence = ++this.eventSequence;
      const rawId = `event:${eventSequence}`;
      const model = meta?.model;
      const decorate = (entry: TraceEntry) => {
        entry.runId = runId;
        entry.turnId = turnId;
        entry.parentRunId = meta?.parentRunId;
        entry.revision = eventSequence;
        entry.raw = { id: rawId, preview: event.type };
        if (model) entry.model = { id: model.id, name: model.name, provider: model.provider };
      };
      if (event.type === "agent_start" || event.type === "turn_start") {
        const entry = this.create(sessionId, "event", event.type);
        decorate(entry);
        if (event.type === "agent_start") run = entry;
        else turn = entry;
        this.update(entry);
      }
      if (event.type === "agent_end" || event.type === "turn_end") {
        const entry =
          (event.type === "agent_end" ? run : turn) ?? this.create(sessionId, "event", event.type);
        decorate(entry);
        entry.status = "completed";
        entry.endedAt = Date.now();
        entry.output = this.storeValue(`${entry.id}:output`, event);
        this.update(entry);
      }
      if (
        event.type === "message_start" ||
        event.type === "message_update" ||
        event.type === "message_end"
      ) {
        if (event.type === "message_start" || !message)
          message = this.create(sessionId, "message", event.message.role);
        decorate(message);
        message.messageId = message.id;
        if (event.message.role === "assistant") {
          for (const block of event.message.content)
            if (block.type === "toolCall") callMessages.set(block.id, message.id);
        }
        if (event.message.role === "toolResult") message.toolCallId = event.message.toolCallId;
        const content = messageContent(event.message);
        message.text = content.text;
        message.thinking = content.thinking;
        message.output = this.storeValue(`${message.id}:output`, event.message);
        if (event.type === "message_end") {
          message.status =
            event.message.role === "assistant" && event.message.stopReason === "error"
              ? "error"
              : "completed";
          message.endedAt = Date.now();
        }
        this.update(message);
      }
      if (event.type === "tool_execution_start") {
        const entry = this.create(sessionId, "tool", event.toolName);
        decorate(entry);
        entry.toolCallId = event.toolCallId;
        entry.messageId = callMessages.get(event.toolCallId);
        const tool = meta?.tools?.find((tool) => tool.name === event.toolName);
        entry.label = tool?.label;
        entry.description = tool?.description;
        entry.input = this.storeValue(`${entry.id}:input`, event.args);
        tools.set(event.toolCallId, entry);
        this.update(entry);
      }
      if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
        const entry = tools.get(event.toolCallId);
        if (!entry) return;
        decorate(entry);
        entry.output = this.storeValue(
          `${entry.id}:output`,
          event.type === "tool_execution_end" ? event.result : event.partialResult,
        );
        if (event.type === "tool_execution_end") {
          entry.status = event.isError ? "error" : "completed";
          entry.endedAt = Date.now();
          tools.delete(event.toolCallId);
        }
        this.update(entry);
      }
      const trace: TraceEvent = {
        id: rawId,
        sequence: eventSequence,
        sessionId,
        runId,
        parentRunId: meta?.parentRunId,
        turnId,
        messageId: event.type.startsWith("message_")
          ? message?.id
          : "toolCallId" in event
            ? callMessages.get(event.toolCallId)
            : undefined,
        toolCallId: "toolCallId" in event ? event.toolCallId : message?.toolCallId,
        timestamp: Date.now(),
        event,
      };
      this.store.put(rawId, "event", eventSequence, trace, runId);
      const step: TraceEntry = {
        id: `step:${eventSequence}`,
        sequence: eventSequence,
        sessionId,
        runId,
        turnId,
        messageId: trace.messageId,
        toolCallId: trace.toolCallId,
        kind: event.type.startsWith("tool_")
          ? "tool"
          : event.type.startsWith("message_")
            ? "message"
            : "event",
        name: event.type,
        status: event.type === "tool_execution_end" && event.isError ? "error" : "completed",
        startedAt: trace.timestamp,
        endedAt: trace.timestamp,
        raw: { id: rawId, preview: event.type },
        revision: eventSequence,
      };
      const outputKey =
        "message" in event
          ? "message"
          : "result" in event
            ? "result"
            : "partialResult" in event
              ? "partialResult"
              : "messages" in event
                ? "messages"
                : undefined;
      if (outputKey) step.output = { id: rawId, path: ["event", outputKey], preview: "完整内容" };
      if ("args" in event) step.input = { id: rawId, path: ["event", "args"], preview: "参数" };
      if ("toolName" in event) {
        const tool = meta?.tools?.find((tool) => tool.name === event.toolName);
        step.label = tool?.label ?? event.toolName;
        step.description = tool?.description;
      }
      if ("message" in event)
        step.label = event.message.role === "assistant" ? "Ciel" : event.message.role;
      if (model) step.model = { id: model.id, name: model.name, provider: model.provider };
      this.store.put(step.id, "step", eventSequence, step, runId);
      this.stepChanges.set(step.id, step);
      this.timer ??= setTimeout(() => this.flush(), 60);

      if (event.type === "message_end") message = undefined;
      for (const wake of this.wakeListeners) wake();
    };
  }

  async *events(afterSequence = 0, signal?: AbortSignal): AsyncGenerator<TraceEvent> {
    let wake: (() => void) | undefined;
    const notify = () => wake?.();
    this.wakeListeners.add(notify);
    signal?.addEventListener("abort", notify);
    try {
      while (!this.closed && !signal?.aborted) {
        const pending = new Promise<void>((resolve) => {
          wake = resolve;
        });
        // 先安装唤醒器，再读水位，避免快照和订阅之间丢事件。
        const events = this.store.list<TraceEvent>("event", {
          after: afterSequence,
          limit: 100,
          ascending: true,
        });
        for (const event of events) {
          afterSequence = event.sequence;
          yield event;
        }
        if (!events.length) await pending;
      }
    } finally {
      this.wakeListeners.delete(notify);
      signal?.removeEventListener("abort", notify);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const wake of this.wakeListeners) wake();
    this.store.close();
    clearTimeout(this.timer);
    this.listeners.clear();
    this.entries.clear();
    this.values.clear();
    this.dirty.clear();
    this.removed.clear();
  }

  private create(sessionId: string, kind: TraceEntry["kind"], name: string): TraceEntry {
    return {
      id: randomUUID(),
      sequence: ++this.sequence,
      sessionId,
      kind,
      name,
      status: "running",
      startedAt: Date.now(),
    };
  }

  private storeValue(id: string, value: unknown): ValueRef {
    this.store.put(id, "value", this.eventSequence, value);
    this.values.set(id, this.store.get(id));
    return { id, preview: preview(value) };
  }

  private update(entry: TraceEntry) {
    this.store.put(entry.id, "entry", entry.sequence, entry, entry.runId);
    if (entry.name === "agent_start")
      this.store.put(`run:${entry.id}`, "run", entry.sequence, entry, entry.runId);
    this.entries.set(entry.id, { ...entry });
    this.dirty.add(entry.id);
    while (this.entries.size > this.capacity) {
      const id = this.entries.keys().next().value!;
      this.entries.delete(id);
      this.values.delete(`${id}:input`);
      this.values.delete(`${id}:output`);
      this.dirty.delete(id);
      this.removed.add(id);
    }
    this.timer ??= setTimeout(() => this.flush(), 60);
  }

  private flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const update = {
      entries: [...this.dirty].flatMap((id) => this.entries.get(id) ?? []),
      removed: [...this.removed],
      steps: [...this.stepChanges.values()],
    };
    this.dirty.clear();
    this.removed.clear();
    this.stepChanges.clear();
    for (const listener of this.listeners) listener(update);
  }
}

function messageContent(message: AgentMessage) {
  if (message.role !== "assistant" && message.role !== "user" && message.role !== "toolResult") {
    return { text: "", thinking: "" };
  }
  if (typeof message.content === "string") return { text: message.content, thinking: "" };
  let text = "";
  let thinking = "";
  for (const block of message.content) {
    if (block.type === "text") text += block.text;
    if (block.type === "thinking") thinking += block.thinking;
  }
  return { text: text, thinking: thinking };
}

function preview(value: unknown): string {
  if (typeof value === "string")
    return value.length > 160 ? `${value.slice(0, 160)}… (${value.length} chars)` : value;
  if (value === null || typeof value !== "object") return String(value).slice(0, 160);
  if (ArrayBuffer.isView(value)) return `${value.constructor.name} (${value.byteLength} bytes)`;
  if (value instanceof ArrayBuffer) return `ArrayBuffer (${value.byteLength} bytes)`;
  if (Array.isArray(value)) return `Array (${value.length})`;
  if (value instanceof Date) return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message.slice(0, 160)}`;
  if (value instanceof Map || value instanceof Set)
    return `${value.constructor.name} (${value.size})`;
  return "Object";
}

function readValue(value: unknown, offset: number): ValuePage {
  const summary = preview(value);
  if (value instanceof Date)
    return { kind: "text", preview: summary, text: String(value), total: 1, offset };
  if (value instanceof Map || value instanceof Set) {
    const items = [];
    const iterator = value instanceof Map ? value.entries() : value.values();
    for (let index = 0; index < Math.min(value.size, offset + 100); index++) {
      const item = iterator.next().value;
      if (index >= offset)
        items.push({ key: String(index), preview: preview(item), expandable: true });
    }
    return {
      kind: "object",
      preview: summary,
      items,
      total: value.size,
      offset,
      nextOffset: offset + 100 < value.size ? offset + 100 : undefined,
    };
  }
  if (typeof value === "string") {
    const text = value.slice(offset, offset + 64_000);
    return {
      kind: "text",
      preview: summary,
      text,
      total: value.length,
      offset,
      nextOffset: offset + text.length < value.length ? offset + text.length : undefined,
    };
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const text = Array.from(bytes.subarray(offset, offset + 256), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(" ");
    return {
      kind: "binary",
      preview: summary,
      text,
      total: bytes.length,
      offset,
      nextOffset: offset + 256 < bytes.length ? offset + 256 : undefined,
    };
  }
  if (!value || typeof value !== "object")
    return { kind: "text", preview: summary, text: summary, total: 1, offset };
  const imageData: unknown = Object.getOwnPropertyDescriptor(value, "data")?.value;
  const mimeType: unknown = Object.getOwnPropertyDescriptor(value, "mimeType")?.value;
  if (
    Object.getOwnPropertyDescriptor(value, "type")?.value === "image" &&
    typeof imageData === "string" &&
    typeof mimeType === "string" &&
    /^image\/(png|jpeg|webp|gif)$/.test(mimeType)
  ) {
    return {
      kind: "image",
      preview: `${mimeType} (${imageData.length} chars)`,
      mimeType,
      text: imageData.slice(offset, offset + 64_000),
      total: imageData.length,
      offset,
      nextOffset: offset + 64_000 < imageData.length ? offset + 64_000 : undefined,
    };
  }
  const keys = Object.getOwnPropertyNames(value);
  const items = keys.slice(offset, offset + 100).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return {
      key,
      preview: "value" in descriptor ? preview(descriptor.value) : "[Getter / Setter]",
      expandable: "value" in descriptor,
    };
  });
  return {
    kind: "object",
    preview: summary,
    items,
    total: keys.length,
    offset,
    nextOffset: offset + 100 < keys.length ? offset + 100 : undefined,
  };
}
