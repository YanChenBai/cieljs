import type { WebContents } from 'electron';
import { expect, it, vi } from 'vite-plus/test';

import { sendDanmaku } from './send-danmaku.ts';

function page(result: unknown, url = 'https://live.bilibili.com/123') {
  const executeJavaScript = vi.fn().mockResolvedValue(result);
  const contents = {
    executeJavaScript,
    getURL: () => url,
    isDestroyed: () => false,
  } as unknown as WebContents;
  return { contents, executeJavaScript };
}

it('通过直播页播放器发送，只有 code=0 确认成功', async () => {
  const { contents, executeJavaScript } = page({ response: { code: 0 } });
  expect(await sendDanmaku(contents, '晚上好')).toMatchObject({
    accepted: true,
    code: 0,
  });
  const code = executeJavaScript.mock.calls[0]![0] as string;
  expect(code).toContain('livePlayer.sendDanmaku');
  expect(code).toContain('晚上好');
});

it('响应缺少状态不能误报成功，服务端拒绝不重试', async () => {
  const unknown = page({});
  await expect(sendDanmaku(unknown.contents, 'hello')).rejects.toThrow('未通过校验');

  const rejected = page({ response: { code: -1, message: '拒绝' } });
  expect(await sendDanmaku(rejected.contents, 'hello')).toMatchObject({
    accepted: false,
    code: -1,
    message: '拒绝',
  });
  expect(rejected.executeJavaScript).toHaveBeenCalledTimes(1);
});

it('不在 B 站直播页时拒绝发送', async () => {
  const blocked = page({ response: { code: 0 } }, 'https://example.com/');
  await expect(sendDanmaku(blocked.contents, 'hello')).rejects.toThrow('页面地址');
  expect(blocked.executeJavaScript).not.toHaveBeenCalled();
});
