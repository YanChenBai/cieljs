import { expect, it } from 'vite-plus/test';

import { readableText } from './content-format.ts';

it('多行工具 JSON 保留转义并展示为 JSON 代码块', () => {
  const value = { messages: [{ content: '第一行\n第二行', path: 'C:\\Videos\\视频.mp4' }] };
  const json = JSON.stringify(value, null, 2);
  expect(readableText(json)).toBe('\n```json\n' + json + '\n```\n');
});

it('已有代码块和普通 Markdown 不重复包裹', () => {
  const text = '# 内容\n```json\n{ "a": 1 }\n```';
  expect(readableText(text)).toBe(text);
});
