// @env node

import { createWriteStream } from 'node:fs';
import { stat, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

import {
  resolveAsrPath,
  resolveModelsPath,
  resolveSpeakerPath,
  resolveVadPath,
} from './constants.ts';

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const QWEN3_ASR_REPOSITORY =
  'https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/master';
const QWEN3_ASR_FILES = [
  'model_1.7B/conv_frontend.onnx',
  'model_1.7B/encoder.int8.onnx',
  'model_1.7B/decoder.int8.onnx',
  'tokenizer/merges.txt',
  'tokenizer/tokenizer_config.json',
  'tokenizer/vocab.json',
] as const;
const VAD_URL = RELEASE + '/asr-models/ten-vad.int8.onnx';
const SPEAKER_URL =
  RELEASE +
  '/speaker-recongition-models/' +
  '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx';

export interface ModelInstallProgress {
  file: string;
  receivedBytes: number;
  totalBytes?: number;
  attempt?: number;
  message?: string;
}

export interface InstallModelsOptions {
  force?: boolean;
  retries?: number;
  retryDelayMs?: number;
  onProgress?: (progress: ModelInstallProgress) => void;
}

export async function installModels(options: InstallModelsOptions = {}): Promise<string> {
  const modelsPath = resolveModelsPath();
  const asrDir = resolveAsrPath();
  const files = [
    ...QWEN3_ASR_FILES.map(file => ({
      url: `${QWEN3_ASR_REPOSITORY}/${file}`,
      target: resolveQwenTarget(asrDir, file),
    })),
    { url: VAD_URL, target: resolveVadPath() },
    { url: SPEAKER_URL, target: resolveSpeakerPath() },
  ];

  for (const file of files) {
    await installFile(file.url, file.target, options);
  }

  return modelsPath;
}

async function installFile(
  url: string,
  target: string,
  options: InstallModelsOptions,
): Promise<void> {
  if (!options.force && (await exists(target))) {
    return;
  }

  await mkdir(path.dirname(target), { recursive: true });
  const temporary = target + '.part';

  const attempts = (options.retries ?? 2) + 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await download(url, temporary, progress => options.onProgress?.({ ...progress, attempt }));
      await rename(temporary, target);
      return;
    } catch (cause) {
      await rm(temporary, { force: true });
      const details = [cause instanceof Error ? cause.message : String(cause)];
      if (cause instanceof Error && cause.cause instanceof Error) details.push(cause.cause.message);
      const detail = details.join('：');
      const message = `${path.basename(target)} 下载失败（第 ${attempt}/${attempts} 次）：${detail}`;
      if (attempt === attempts) throw new Error(message, { cause });
      options.onProgress?.({ file: path.basename(target), receivedBytes: 0, attempt, message });
      await delay((options.retryDelayMs ?? 1_000) * attempt);
    }
  }
}

async function download(
  url: string,
  target: string,
  onProgress?: (progress: ModelInstallProgress) => void,
): Promise<void> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30 * 60_000),
  });

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`模型下载失败（HTTP ${response.status}）：${url}`);
  }

  const file = path.basename(target).replace(/\.part$/u, '');
  const contentLength = Number(response.headers.get('content-length'));
  const totalBytes =
    Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined;
  let receivedBytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      onProgress?.({ file, receivedBytes, totalBytes });
      callback(null, chunk);
    },
  });

  onProgress?.({ file, receivedBytes, totalBytes });
  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(target));
  if (receivedBytes === 0 || (totalBytes !== undefined && receivedBytes !== totalBytes)) {
    throw new Error(`模型文件不完整：${file}（${receivedBytes}/${totalBytes ?? '未知'} 字节）`);
  }
}

function resolveQwenTarget(directory: string, file: string): string {
  return file.startsWith('tokenizer/')
    ? path.join(directory, file)
    : path.join(directory, path.basename(file));
}

async function exists(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
