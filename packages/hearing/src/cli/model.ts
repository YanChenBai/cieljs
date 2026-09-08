import { parseArgs } from 'node:util';

import { installModels } from '../model-installer.ts';
import { progress } from './utils/index.ts';

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
        'Qwen3-ASR, VAD, and speaker models are installed into CIEL_DATA_DIR/models.\n',
    );
    return;
  }

  let currentFile = '';
  const modelsPath = await installModels({
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
