import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { Perception } from '@cieljs/perception';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { ffmpegArguments, LiveMedia } from './live-media.ts';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
beforeEach(() => vi.resetAllMocks());

function setup(live = true) {
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
  const onProgress = vi.fn();
  const imageWrite = vi.fn().mockResolvedValue(undefined);
  const audioWrite = vi.fn();
  const media = new LiveMedia({
    roomId: 123,
    input: 'https://example.com/live',
    live,
    perception: {
      asr: { write: audioWrite },
      image: { write: imageWrite },
    } as unknown as Perception,
    onStopped,
    onError,
    onProgress,
  });
  media.start();
  return { media, child, onStopped, onError, onProgress, imageWrite, audioWrite };
}

it('加速解码的帧按媒体时间分布，进度支持分块输出', async () => {
  const { media, child, imageWrite, onProgress } = setup(false);
  child.stdio[3]!.write(Buffer.from([255, 216, 255, 217, 255, 216, 255, 217]));
  expect(
    imageWrite.mock.calls[1]![0].at.getTime() - imageWrite.mock.calls[0]![0].at.getTime(),
  ).toBe(6666);
  child.stderr.write('Duration: 00:02:00.00, start: 0\nout_time_');
  child.stderr.write('us=60000000\n');
  expect(onProgress).toHaveBeenCalledWith(60, 120);
  expect(media.endAt.getTime()).toBe(imageWrite.mock.calls[1]![0].at.getTime());
  await media.close();
});

it('ASR 写入等待 worker 时不暂停 FFmpeg 音频流', async () => {
  const { media, child, audioWrite } = setup();
  let resolveWrite!: () => void;
  audioWrite.mockReturnValue(
    new Promise<void>(resolve => {
      resolveWrite = resolve;
    }),
  );

  child.stdout.write(Buffer.alloc(320));

  expect(audioWrite).toHaveBeenCalledTimes(1);
  expect(child.stdout.isPaused()).toBe(false);

  resolveWrite();
  await media.close();
});

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

it('视频加速预处理并报告进度，直播保留断线重连参数', () => {
  const recording = ffmpegArguments(123, 'C:\\Videos\\recording.mp4', false);
  const live = ffmpegArguments(123, 'https://example.com/live.flv', true);

  expect(recording).not.toContain('-re');
  expect(recording).toContain('-progress');
  expect(live).toContain('-reconnect');
  expect(live).not.toContain('-re');
});
