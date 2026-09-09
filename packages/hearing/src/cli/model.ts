import { parseArgs } from 'node:util';

import { installKWSModels } from '../kws.ts';
import { installModels } from '../model-installer.ts';
import { ASR_MODELS, DEFAULT_ASR_MODEL, type ASRModelId } from '../registry.ts';
import { progress } from './utils/index.ts';

export async function installModel(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      model: { type: 'string', default: DEFAULT_ASR_MODEL },
      kws: { type: 'boolean', default: false },
      'no-speaker': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(
      'Usage: vp run @cieljs/hearing#install-model -- [--model ID] [--kws] [--no-speaker] [--force]\n\n' +
        'Choose qwen3-asr-1.7b-int8 or sensevoice-small; --kws installs the wake model.\n',
    );
    return;
  }

  if (!values.kws && !Object.hasOwn(ASR_MODELS, values.model!))
    throw new Error('Unsupported ASR model: ' + values.model);
  let currentFile = '';
  const modelsPath = await (values.kws ? installKWSModels : installModels)({
    model: values.model as ASRModelId,
    speaker: values['no-speaker'] ? false : undefined,
    force: values.force,
    onProgress: current => {
      if (current.file !== currentFile) {
        currentFile = current.file;
        process.stdout.write(`Downloading ${current.file}\n`);
      }

      if (current.totalBytes) {
        progress(current.receivedBytes, current.totalBytes);
      }
    },
  });

  process.stdout.write(`ASR models installed in ${modelsPath}\n`);
}
