import type { AgentEvent } from "@earendil-works/pi-agent-core";
export const DEVTOOLS_CHANNEL = "ciel:devtools";

export interface TraceEntry {
  id: string;
  sequence: number;
  sessionId: string;
  kind: "message" | "tool" | "event";
  name: string;
  label?: string;
  description?: string;
  runId?: string;
  parentRunId?: string;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  model?: { id: string; name: string; provider: string };
  revision?: number;
  raw?: ValueRef;
  status: "running" | "completed" | "error";
  startedAt: number;
  endedAt?: number;
  text?: string;
  thinking?: string;
  input?: ValueRef;
  output?: ValueRef;
}

export interface ValueRef {
  id: string;
  path?: string[];
  preview: string;
}
export interface ValueItem {
  key: string;
  preview: string;
  expandable: boolean;
}
export interface ValuePage {
  kind: "object" | "text" | "image" | "binary";
  preview: string;
  items?: ValueItem[];
  text?: string;
  mimeType?: string;
  total: number;
  offset: number;
  nextOffset?: number;
}

export type DevtoolsRequest =
  | { type: "snapshot" }
  | { type: "read"; id: string; path?: string[]; offset?: number }
  | { type: "clear" };
export type DevtoolsResponse = { entries: TraceEntry[] } | ValuePage | { cleared: true };
export interface DevtoolsUpdate {
  entries: TraceEntry[];
  steps?: TraceEntry[];
  removed: string[];
}

export interface DevtoolsTransport {
  request(request: DevtoolsRequest): Promise<DevtoolsResponse>;
  subscribe(listener: (update: DevtoolsUpdate) => void): () => void;
}

export function parseRequest(value: unknown): DevtoolsRequest {
  if (!value || typeof value !== "object" || !("type" in value))
    throw new Error("无效的 DevTools 请求");
  if (value.type === "snapshot" || value.type === "clear") return { type: value.type };
  if (
    value.type !== "read" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    value.id.length > 200
  )
    throw new Error("无效的内容引用");
  const path = "path" in value ? value.path : [];
  const offset = "offset" in value ? value.offset : 0;
  if (
    !Array.isArray(path) ||
    path.length > 32 ||
    path.some(
      (key) =>
        typeof key !== "string" ||
        key.length > 1024 ||
        ["__proto__", "constructor", "prototype"].includes(key),
    )
  )
    throw new Error("无效的内容路径");
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
    throw new Error("无效的分页位置");
  return { type: "read", id: value.id, path, offset };
}

export interface TraceEvent {
  id: string;
  sequence: number;
  sessionId: string;
  runId: string;
  parentRunId?: string;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  timestamp: number;
  event: AgentEvent;
}
