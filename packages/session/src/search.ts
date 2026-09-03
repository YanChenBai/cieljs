import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * AgentMessage → 可搜索文本。
 *
 * 默认忽略 thinking。
 */
export function messageToSearchText(message: AgentMessage): string {
  const content = (
    message as {
      content?: unknown;
    }
  ).content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];

  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const item = block as Record<string, unknown>;

    switch (item.type) {
      case "text": {
        if (typeof item.text === "string") {
          parts.push(item.text);
        }

        break;
      }

      case "toolCall": {
        if (typeof item.name === "string") {
          parts.push(item.name);
        }

        if (item.arguments !== undefined) {
          try {
            parts.push(JSON.stringify(item.arguments));
          } catch {
            parts.push("[工具参数无法序列化]");
          }
        }

        break;
      }

      /**
       * 不把 reasoning / thinking
       * 放入搜索索引。
       */
      case "thinking":
        break;
    }
  }

  return parts.join("\n").trim();
}

/**
 * 第一版 normalization。
 *
 * 后面你可以替换成：
 *
 * jieba / 自定义中文 tokenizer
 *
 * 输出：
 *
 * "上下文 压缩 session ..."
 */
export function normalizeSearchText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export interface TextChunk {
  content: string;
  searchText: string;
}

/**
 * 简单字符 Chunk。
 *
 * 普通对话一般只有 1 chunk。
 * 大 toolResult 才会拆。
 */
export function chunkSearchText(text: string, maxChars = 4_000, overlap = 300): TextChunk[] {
  if (
    !Number.isSafeInteger(maxChars) ||
    maxChars < 1 ||
    !Number.isSafeInteger(overlap) ||
    overlap < 0 ||
    overlap >= maxChars
  ) {
    throw new TypeError("分块长度必须是正整数，重叠长度必须是小于分块长度的非负整数");
  }
  const normalized = normalizeSearchText(text);

  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxChars) {
    return [
      {
        content: text,
        searchText: normalized,
      },
    ];
  }

  const chunks: TextChunk[] = [];

  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);

    const content = normalized.slice(start, end);

    chunks.push({
      content,
      searchText: normalizeSearchText(content),
    });

    if (end === normalized.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
