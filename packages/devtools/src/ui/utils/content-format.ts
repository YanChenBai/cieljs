// 仅格式化完整独立的 JSON 行，保留原始消息与已有 Markdown 代码块。
export function readableText(value: string) {
  // 工具结果常是多行 JSON，必须整体识别，否则会被 Markdown 当作普通段落。
  const trimmed = value.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      const data = JSON.parse(trimmed);
      if (data && typeof data === 'object') {
        return '\n```json\n' + JSON.stringify(data, null, 2) + '\n```\n';
      }
    } catch {
      // 混合文本继续按行处理，已有代码块保持原样。
    }
  }
  let fenced = false;

  return value
    .split('\n')
    .map(line => {
      if (line.trimStart().startsWith('```')) {
        fenced = !fenced;
        return line;
      }
      const trimmed = line.trim();
      if (fenced || !/^[[{]/.test(trimmed)) return line;
      try {
        const data = JSON.parse(trimmed);
        if (!data || typeof data !== 'object') return line;
        return '\n```json\n' + JSON.stringify(data, null, 2) + '\n```\n';
      } catch {
        return line;
      }
    })
    .join('\n');
}

export function imageSource(block: Record<string, unknown>) {
  if (
    typeof block.mimeType !== 'string' ||
    !/^image\/(png|jpeg|webp|gif)$/.test(block.mimeType) ||
    typeof block.data !== 'string'
  ) {
    return undefined;
  }

  return `data:${block.mimeType};base64,${block.data}`;
}
