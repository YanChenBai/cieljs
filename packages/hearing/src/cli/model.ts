import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

import {
  resolveAsrPath,
  resolveModelsPath,
  resolveSpeakerPath,
  resolveVadPath,
} from '../constants.ts';
import { loading, progress } from './utils/index.ts';

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

export async function installModel(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(
      'Usage: vp run @cieljs/hearing#install-model -- [--force]\n\n' +
        "Qwen3-ASR, VAD, and speaker models are installed into the package's models/ directory.\n",
    );
    return;
  }

  await installModels(values.force);
}

async function installModels(force: boolean): Promise<void> {
  const modelsPath = resolveModelsPath();
  const asrDir = resolveAsrPath();
  const vadFile = resolveVadPath();
  const speakerFile = resolveSpeakerPath();

  const asrFiles = QWEN3_ASR_FILES.map(file => resolveQwenTarget(asrDir, file));
  if (force || !(await allExist(asrFiles))) {
    for (const file of QWEN3_ASR_FILES) {
      const target = resolveQwenTarget(asrDir, file);
      await installFile(`${QWEN3_ASR_REPOSITORY}/${file}`, target, force);
    }
  } else {
    process.stdout.write('ASR model already installed\n');
  }

  await installFile(VAD_URL, vadFile, force);
  await installFile(SPEAKER_URL, speakerFile, force);
  process.stdout.write('ASR models installed in ' + modelsPath + '\n');
}

async function installFile(url: string, target: string, force: boolean): Promise<void> {
  if (!force && (await exists(target))) {
    process.stdout.write(path.basename(target) + ' already installed\n');
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = target + '.part';
  await download(url, temporary);
  await rm(target, { force: true });
  await rename(temporary, target);
}

async function download(url: string, target: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
  }

  const name = path.basename(target).replace(/\.part$/, '');
  const total = Number(response.headers.get('content-length'));
  const source = Readable.fromWeb(response.body as never);
  if (Number.isFinite(total) && total > 0) {
    let current = 0;
    process.stdout.write('Downloading ' + name + '\n');
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        current += chunk.length;
        progress(current, total);
        callback(null, chunk);
      },
    });
    await pipeline(source, meter, createWriteStream(target));
    if (current < total) progress(total, total);
    return;
  }

  const stop = loading('Downloading ' + name);
  try {
    await pipeline(source, createWriteStream(target));
  } finally {
    stop();
  }
}

async function allExist(targets: readonly string[]): Promise<boolean> {
  const results = await Promise.all(targets.map(exists));
  return results.every(Boolean);
}

function resolveQwenTarget(directory: string, file: string): string {
  return file.startsWith('tokenizer/')
    ? path.join(directory, file)
    : path.join(directory, path.basename(file));
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
