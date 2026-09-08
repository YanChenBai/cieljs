import { createInterface } from 'node:readline';

import { NativeASR } from './asr.ts';
import type { ASRWorkerCommand, ASRWorkerEvent } from './process-protocol.ts';

let asr: NativeASR | undefined;

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  let command: ASRWorkerCommand;
  try {
    command = JSON.parse(line) as ASRWorkerCommand;
  } catch (error) {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      fatal: true,
    });
    return;
  }
  try {
    handle(command);
  } catch (error) {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      ...(command.type === 'init' ? { fatal: true } : {}),
    });
  }
});

function handle(command: ASRWorkerCommand): void {
  if (command.type === 'init') {
    asr = new NativeASR(command.options);
    asr.on('result', data =>
      send({
        type: 'result',
        data: {
          ...data,
          startAt: data.startAt.toISOString(),
          endAt: data.endAt.toISOString(),
          tokens: data.tokens?.map(token => ({
            ...token,
            startAt: token.startAt.toISOString(),
            endAt: token.endAt.toISOString(),
          })),
        },
      }),
    );
    asr.on('speechstart', at => send({ type: 'speechstart', at: at.toISOString() }));
    asr.on('speechend', at => send({ type: 'speechend', at: at.toISOString() }));
    asr.on('error', error => send({ type: 'error', message: error.message }));
    send({ type: 'ready' });
    return;
  }
  if (command.type === 'close') {
    asr?.flush();
    process.exit(0);
  }
  if (!asr) return;
  if (command.type === 'write') {
    asr.write({ data: Buffer.from(command.data, 'base64'), startAt: new Date(command.startAt) });
  } else {
    asr.flush();
  }
}

function send(event: ASRWorkerEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
