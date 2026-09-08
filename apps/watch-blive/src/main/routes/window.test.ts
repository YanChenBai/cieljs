import { createRouterClient } from '@orpc/server';
import type { BrowserWindow } from 'electron';
import { expect, it, vi } from 'vite-plus/test';

import type { LivePage } from '../bilibili/live-page.ts';
import { createWindowRoutes } from './window.ts';

const { fromId } = vi.hoisted(() => ({ fromId: vi.fn() }));
vi.mock('electron', () => ({ webContents: { fromId } }));

it('直播间新窗口转成确认请求，外部链接不触发单推', async () => {
  const host = {};
  const setWindowOpenHandler = vi.fn();
  const loadURL = vi.fn().mockResolvedValue(undefined);
  fromId.mockReturnValue({
    isDestroyed: () => false,
    hostWebContents: host,
    getURL: () => 'https://live.bilibili.com/',
    setWindowOpenHandler,
    loadURL,
  });
  const requestRoom = vi.fn();
  const client = createRouterClient(
    createWindowRoutes(
      { webContents: host } as BrowserWindow,
      { attach: vi.fn() } as unknown as LivePage,
      requestRoom,
    ),
  );
  await client.attach({ id: 1 });
  const open = setWindowOpenHandler.mock.calls[0]![0];
  expect(open({ url: 'https://live.bilibili.com/123?from=home' })).toEqual({ action: 'deny' });
  expect(requestRoom).toHaveBeenCalledExactlyOnceWith(123);
  expect(loadURL).not.toHaveBeenCalled();
  for (const url of [
    'https://live.bilibili.com/all',
    'https://live.bilibili.com/p/eden/area-tags?parentAreaId=9&areaId=0',
    'https://space.bilibili.com/194484313',
  ]) {
    expect(open({ url })).toEqual({ action: 'deny' });
    expect(loadURL).toHaveBeenLastCalledWith(url);
  }
  loadURL.mockClear();
  for (const url of ['https://example.com/123', 'javascript:alert(1)']) {
    expect(open({ url })).toEqual({ action: 'deny' });
  }
  expect(requestRoom).toHaveBeenCalledOnce();
  expect(loadURL).not.toHaveBeenCalled();
});
