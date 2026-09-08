import { shallowRef, watch } from 'vue';

import type { DevtoolsClient } from '../../client/index.ts';
import type { TraceEntry } from '../../protocol/index.ts';

export type TraceSection = 'input' | 'output' | 'raw';

/** 仅加载当前查看的内容；切换记录或版本时取消旧请求，避免旧响应覆盖新选择。 */
export function useTraceValue(
  client: () => DevtoolsClient,
  entry: () => TraceEntry,
  section: () => TraceSection | undefined,
) {
  const value = shallowRef<unknown>();
  const error = shallowRef('');
  const loading = shallowRef(false);

  watch(
    () => [client(), entry().id, entry().revision, section()] as const,
    async ([nextClient, nextId, , nextSection], previous, onCleanup) => {
      const controller = new AbortController();
      onCleanup(() => controller.abort());

      // 同一条流式消息更新时保留旧内容；换记录或标签时才清空，避免闪烁。
      const selectionChanged =
        nextClient !== previous?.[0] || nextId !== previous?.[1] || nextSection !== previous?.[3];
      if (selectionChanged) value.value = undefined;

      error.value = '';
      loading.value = false;

      const key = section();
      const reference = key ? entry()[key] : undefined;
      if (!reference) return;

      loading.value = true;

      try {
        const result = await client().values.get(reference, { signal: controller.signal });
        if (!controller.signal.aborted) value.value = result;
      } catch (cause) {
        if (!controller.signal.aborted) error.value = String(cause);
      } finally {
        if (!controller.signal.aborted) loading.value = false;
      }
    },
    { immediate: true },
  );

  return { value, error, loading };
}
