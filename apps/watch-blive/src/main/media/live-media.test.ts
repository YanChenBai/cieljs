import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { Perception } from '@cieljs/perception';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { LiveMedia } from './live-media.ts';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
beforeEach(() => vi.resetAllMocks());

function setup() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdio: [null, null, null, new PassThrough()],
    killed: false,
    kill: vi.fn(),
  });
  child.kill.mockImplementation(() => {
    child.killed = true;
    child.emit('close', 0, 'SIGTERM');
  });
  spawn.mockReturnValue(child);
  const onStopped = vi.fn();
  const onError = vi.fn();
  const media = new LiveMedia({
    roomId: 123,
    playUrl: 'https://example.com/live',
    perception: {} as Perception,
    onStopped,
    onError,
  });
  media.start();
  return { media, child, onStopped, onError };
}

it('自然 EOF 也通知宿主，不遗留失去媒体的 watching 状态', async () => {
  const { media, child, onStopped } = setup();
  child.emit('close', 0, null);
  expect(onStopped).toHaveBeenCalledWith(undefined);
  await media.close();
});

it('进程启动失败与后续 close 只发一次终止通知', async () => {
  const { media, child, onStopped, onError } = setup();
  const error = new Error('spawn ENOENT');
  child.emit('error', error);
  child.emit('close', -2, null);
  expect(onStopped).toHaveBeenCalledExactlyOnceWith(error);
  expect(onError).not.toHaveBeenCalled();
  await media.close();
});

it('主动停止会等待 close，但不当作下播或异常退出', async () => {
  const { media, child, onStopped } = setup();
  await media.close();
  expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  expect(onStopped).not.toHaveBeenCalled();
});
