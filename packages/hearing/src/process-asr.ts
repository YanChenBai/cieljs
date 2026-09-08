import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import type { ASRWorkerCommand, ASRWorkerEvent } from './process-protocol.ts';
import type { ASREventMap, ASROptions, ASRResult, ASRSegment, Unsubscribe } from './types.ts';

export class ProcessASR {
  private readonly emitter = new EventEmitter();
  private readonly process: ChildProcessWithoutNullStreams;
  private output = '';
  private closing = false;
  private failed = false;
  private ready = false;
  private readonly pending: ASRWorkerCommand[] = [];

  constructor(options: ASROptions) {
    const executable = process.env.CIEL_NODE_EXECUTABLE?.trim() || 'node';
    const worker = new URL('./worker.mjs', import.meta.url);
    this.process = spawn(executable, [fileURLToPath(worker)], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');
    this.process.stdout.on('data', chunk => this.consume(String(chunk)));
    this.process.stderr.on('data', chunk => {
      const messages = String(chunk)
        .split(/\r?\n/u)
        .map(message => message.trim())
        .filter(Boolean);
      for (const message of messages) {
        if (message.includes('Result is truncated. max_new_tokens')) continue;
        this.emit('error', new Error(`ASR worker: ${message}`));
      }
    });
    this.process.on('error', error => this.emit('error', toError(error)));
    this.process.on('exit', code => {
      if (!this.closing && code !== 0) {
        this.emit('error', new Error(`ASR worker exited with code ${String(code)}`));
      }
    });
    this.sendNow({ type: 'init', options });
  }

  write(segment: ASRSegment): void {
    this.send({
      type: 'write',
      data: segment.data.toString('base64'),
      startAt: segment.startAt.toISOString(),
    });
  }

  flush(): void {
    this.send({ type: 'flush' });
  }

  on<K extends keyof ASREventMap>(event: K, callback: ASREventMap[K]): Unsubscribe {
    this.emitter.on(event, callback);

    return () => this.emitter.off(event, callback);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.send({ type: 'close' });
    await new Promise<void>(resolve => {
      if (this.process.exitCode !== null) resolve();
      else this.process.once('close', () => resolve());
    });
  }

  private send(command: ASRWorkerCommand): void {
    if (this.failed && command.type !== 'close') return;
    if (!this.ready && !this.failed && command.type !== 'init') {
      this.pending.push(command);
      return;
    }
    this.sendNow(command);
  }

  private sendNow(command: ASRWorkerCommand): void {
    if (this.process.stdin.destroyed) return;
    this.process.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private consume(chunk: string): void {
    this.output += chunk;
    let newline = this.output.indexOf('\n');
    while (newline >= 0) {
      const line = this.output.slice(0, newline).trim();
      this.output = this.output.slice(newline + 1);
      if (line) {
        try {
          this.handle(JSON.parse(line) as ASRWorkerEvent);
        } catch (error) {
          this.emit('error', toError(error));
        }
      }
      newline = this.output.indexOf('\n');
    }
  }

  private handle(event: ASRWorkerEvent): void {
    if (event.type === 'ready') {
      this.ready = true;
      for (const command of this.pending.splice(0)) this.sendNow(command);
      return;
    }
    if (event.type === 'error') {
      if (event.fatal) {
        this.failed = true;
        this.pending.length = 0;
        this.sendNow({ type: 'close' });
      }
      this.emit('error', new Error(event.message));
      return;
    }
    if (event.type === 'speechstart' || event.type === 'speechend') {
      this.emit(event.type, new Date(event.at));
      return;
    }
    if (event.type !== 'result') return;
    const data: ASRResult = {
      ...event.data,
      startAt: new Date(event.data.startAt),
      endAt: new Date(event.data.endAt),
      tokens: event.data.tokens?.map(token => ({
        ...token,
        startAt: new Date(token.startAt),
        endAt: new Date(token.endAt),
      })),
    };
    this.emit('result', data);
  }

  private emit<K extends keyof ASREventMap>(event: K, ...args: Parameters<ASREventMap[K]>): void {
    this.emitter.emit(event, ...args);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
