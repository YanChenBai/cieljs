import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const recognizerResult = vi.hoisted(() => ({
  calls: 0,
  degenerateTokenCount: 256,
  splitRetry: false,
  text: 'language Chinese<asr_text>你好',
  tokens: [] as string[],
  vadSamples: 16_000,
}));

vi.mock('sherpa-onnx-node', () => {
  class FakeStream {
    decoded = false;
    sampleCount = 0;

    acceptWaveform(input: { samples: Float32Array }): void {
      this.sampleCount = input.samples.length;
    }

    inputFinished(): void {}
  }

  class CircularBuffer {
    private readonly samples: number[] = [];

    push(samples: Float32Array): void {
      this.samples.push(...samples);
    }

    get(start: number, length: number): Float32Array {
      return Float32Array.from(this.samples.slice(start, start + length));
    }

    pop(length: number): void {
      this.samples.splice(0, length);
    }

    size(): number {
      return this.samples.length;
    }

    head(): number {
      return 0;
    }

    reset(): void {
      this.samples.length = 0;
    }
  }

  class Vad {
    private readonly segments: {
      start: number;
      samples: Float32Array;
    }[] = [];

    acceptWaveform(): void {}

    flush(): void {
      this.segments.push({
        start: 1_600,
        samples: new Float32Array(recognizerResult.vadSamples),
      });
    }

    isEmpty(): boolean {
      return this.segments.length === 0;
    }

    front(): { start: number; samples: Float32Array } {
      return this.segments[0]!;
    }

    pop(): void {
      this.segments.shift();
    }

    reset(): void {
      this.segments.length = 0;
    }
  }

  class OfflineRecognizer {
    createStream(): FakeStream {
      return new FakeStream();
    }

    decode(stream: FakeStream): void {
      stream.decoded = true;
    }

    getResult(stream: FakeStream): object {
      recognizerResult.calls += 1;
      const retryingLongSegment =
        recognizerResult.splitRetry && stream.sampleCount === recognizerResult.vadSamples;
      return {
        text: retryingLongSegment
          ? `language Chinese<asr_text>${'这啊，'.repeat(80)}`
          : recognizerResult.text,
        lang: '<|zh|>',
        emotion: '<|NEUTRAL|>',
        event: '<|Speech|>',
        tokens: retryingLongSegment
          ? Array.from({ length: recognizerResult.degenerateTokenCount }, () => 'token')
          : recognizerResult.tokens,
        timestamps: [],
        durations: [],
        ys_log_probs: [],
        words: [],
      };
    }
  }

  class SpeakerEmbeddingExtractor {
    readonly dim = 2;

    createStream(): FakeStream {
      return new FakeStream();
    }

    isReady(): boolean {
      return true;
    }

    compute(): Float32Array {
      return Float32Array.of(1, 0);
    }
  }

  return {
    default: {
      CircularBuffer,
      OfflineRecognizer,
      SpeakerEmbeddingExtractor,
      Vad,
    },
  };
});

const { ASR } = await import('../src/asr.ts');

describe('ASR', () => {
  beforeEach(() => {
    recognizerResult.calls = 0;
    recognizerResult.degenerateTokenCount = 256;
    recognizerResult.splitRetry = false;
    recognizerResult.text = 'language Chinese<asr_text>你好';
    recognizerResult.tokens = [];
    recognizerResult.vadSamples = 16_000;
  });

  it('emits timestamped final results with a stable speaker', () => {
    const asr = new ASR();
    const results: import('../src/types.ts').ASRResult[] = [];
    asr.on('result', result => results.push(result));

    const startAt = new Date('2026-08-09T00:00:00.000Z');
    asr.write({
      data: Buffer.alloc(1_024),
      startAt,
    });
    asr.flush();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      content: '你好',
      speaker: 'speaker_0',
      startAt: new Date('2026-08-09T00:00:00.100Z'),
      endAt: new Date('2026-08-09T00:00:01.100Z'),
    });
    expect(results[0]!.confidence).toBeUndefined();
    expect(results[0]!.tokens).toBeUndefined();
  });

  it('emits input errors without throwing from write', () => {
    const asr = new ASR();
    const errors: Error[] = [];
    asr.on('error', error => errors.push(error));

    asr.write({
      data: Buffer.alloc(1),
      startAt: new Date(0),
    });

    expect(errors[0]?.message).toContain('aligned s16le');
  });

  it('drops transcripts that still hit the token limit after shorter retries', () => {
    recognizerResult.text = 'language Chinese<asr_text>未完成';
    recognizerResult.tokens = Array.from({ length: 256 }, () => 'token');
    const asr = new ASR();
    const results: import('../src/types.ts').ASRResult[] = [];
    asr.on('result', result => results.push(result));

    asr.write({ data: Buffer.alloc(1_024), startAt: new Date(0) });
    asr.flush();

    expect(results).toEqual([]);
  });

  it('drops excessively repetitive transcripts', () => {
    recognizerResult.text = `language Chinese<asr_text>啊，这个点都是广东人。${'这啊，'.repeat(80)}`;
    recognizerResult.tokens = [];
    const asr = new ASR();
    const results: import('../src/types.ts').ASRResult[] = [];
    asr.on('result', result => results.push(result));

    asr.write({ data: Buffer.alloc(1_024), startAt: new Date(0) });
    asr.flush();

    expect(results).toEqual([]);
  });

  it('retries a degenerate long segment as two shorter transcriptions', () => {
    recognizerResult.splitRetry = true;
    recognizerResult.text = 'language Chinese<asr_text>恢复';
    recognizerResult.vadSamples = 160_000;
    const asr = new ASR();
    const results: import('../src/types.ts').ASRResult[] = [];
    asr.on('result', result => results.push(result));

    asr.write({ data: Buffer.alloc(1_024), startAt: new Date(0) });
    asr.flush();

    expect(recognizerResult.calls).toBe(3);
    expect(results.map(result => result.content)).toEqual(['恢复恢复']);
  });

  it('retries before sherpa enters its 65-token repetition guard', () => {
    recognizerResult.degenerateTokenCount = 65;
    recognizerResult.splitRetry = true;
    recognizerResult.text = 'language Chinese<asr_text>恢复';
    recognizerResult.vadSamples = 160_000;
    const asr = new ASR();
    const results: import('../src/types.ts').ASRResult[] = [];
    asr.on('result', result => results.push(result));

    asr.write({ data: Buffer.alloc(1_024), startAt: new Date(0) });
    asr.flush();

    expect(recognizerResult.calls).toBe(3);
    expect(results.map(result => result.content)).toEqual(['恢复恢复']);
  });
});

it('SenseVoice 事件窗口不依赖 VAD，空文本事件保留且 flush 不重复输出', async () => {
  recognizerResult.text = '';
  const asr = new ASR({
    model: 'sensevoice-small',
    mode: 'events',
    speaker: false,
    eventWindowSeconds: 1,
  });
  const results: import('../src/types.ts').ASRResult[] = [];
  asr.on('result', result => results.push(result));
  asr.write({ data: Buffer.alloc(48_000), startAt: new Date(0) });
  asr.flush();
  asr.flush();
  expect(results).toHaveLength(2);
  expect(results[0]).toMatchObject({
    content: '',
    language: 'zh',
    emotion: 'neutral',
    events: [{ type: 'speech' }],
    startAt: new Date(0),
    endAt: new Date(1000),
  });
  expect(results[1]?.endAt).toEqual(new Date(1500));
  await asr.close();
});
