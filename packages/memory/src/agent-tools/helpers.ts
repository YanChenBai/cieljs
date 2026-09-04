import type { MemoryEntry } from "../types.ts";

export function createMemoryPreview(maxReadChars: number) {
  return (memory: MemoryEntry) => ({
    ...memory,
    content: memory.content.slice(0, maxReadChars),
    truncated: memory.content.length > maxReadChars,
  });
}

export function createMemoryResult() {
  return (details: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details,
  });
}
