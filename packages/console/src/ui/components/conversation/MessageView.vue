<script setup lang="ts">
import type { TraceClient } from '@cieljs/trace/client';
import type { TraceEntry } from '@cieljs/trace/protocol';
import { computed } from 'vue';

import { useTraceValue } from '../../composables/use-trace-value.ts';
import type { MessageRendererProps, MessageRenderers } from '../../message-renderers.ts';
import { messageRenderer } from '../../message-renderers.ts';
import type { ToolRenderers } from '../../tool-renderers.ts';
import { messageText, wholeJson } from '../../utils/content-format.ts';
import type { ToolCallRecord } from '../../utils/tool-calls.ts';
import ContentRenderer from '../content/ContentRenderer.vue';
import StatusIcon from '../content/StatusIcon.vue';

const props = defineProps<{
  client: TraceClient;
  entry: TraceEntry;
  toolCalls?: ReadonlyMap<string, ToolCallRecord>;
  toolRenderers?: ToolRenderers;
  /** 命中谓词的消息交给宿主组件渲染，其余走默认渲染。 */
  messageRenderers?: MessageRenderers;
}>();

const { value, error, loading } = useTraceValue(
  () => props.client,
  () => props.entry,
  () => 'output',
);

// 时间与来源共用一行，正文不再被重复的角色标题打断。
const clock = computed(() =>
  new Date(props.entry.startedAt).toLocaleTimeString('zh-CN', { hour12: false }),
);

const text = computed(() => messageText(value.value));
const json = computed(() => (text.value === undefined ? undefined : wholeJson(text.value)));

const hasRenderableContent = computed(() => {
  const current = value.value;
  if (typeof current === 'string') return current.length > 0;
  if (!current || typeof current !== 'object') return false;
  if (!('content' in current)) return true;

  const content = current.content;
  if (typeof content === 'string') return content.length > 0;
  return Array.isArray(content) && content.length > 0;
});

const terminalState = computed(() => {
  const current = value.value;
  if (!current || typeof current !== 'object' || !('role' in current)) return undefined;
  if (current.role !== 'assistant' || !('stopReason' in current)) return undefined;

  const stopReason = current.stopReason;
  const errorMessage =
    'errorMessage' in current && typeof current.errorMessage === 'string'
      ? current.errorMessage
      : undefined;

  if (stopReason === 'error') {
    return {
      kind: 'error',
      title: '生成失败',
      detail: errorMessage ?? '模型请求未能完成。',
    } as const;
  }
  if (stopReason === 'aborted') {
    return {
      kind: 'aborted',
      title: '生成已取消',
      detail: errorMessage ?? '这次生成在完成前被中止。',
    } as const;
  }
  if (stopReason === 'length') {
    return {
      kind: 'warning',
      title: '输出已截断',
      detail: '达到模型输出长度限制，当前回复可能不完整。',
    } as const;
  }

  return undefined;
});

const showSkeleton = computed(
  () =>
    props.entry.name === 'assistant' &&
    props.entry.status === 'running' &&
    !hasRenderableContent.value,
);

const renderer = computed(() =>
  messageRenderer(
    { name: props.entry.name, label: props.entry.label, text: text.value ?? '', json: json.value },
    props.messageRenderers,
  ),
);

const rendererProps = computed<MessageRendererProps>(() => ({
  name: props.entry.name,
  label: props.entry.label,
  text: text.value ?? '',
  json: json.value,
  model: props.entry.model?.name,
  status: props.entry.status,
}));
</script>

<template>
  <article class="dt-message" :data-role="entry.name" :data-status="entry.status">
    <header class="dt-message-meta">
      <span class="dt-message-marker" aria-hidden="true" />
      <span v-if="entry.label" class="dt-message-note">{{ entry.label }}</span>
      <time :datetime="new Date(entry.startedAt).toISOString()">{{ clock }}</time>
      <StatusIcon
        v-if="entry.status !== 'completed'"
        class="dt-message-state"
        :status="entry.status"
      />
    </header>

    <div v-if="error" class="dt-message-state-card" data-kind="error" role="alert">
      <strong>内容读取失败</strong>
      <span>{{ error }}</span>
    </div>

    <template v-else>
      <div
        v-if="terminalState"
        class="dt-message-state-card"
        :data-kind="terminalState.kind"
        :role="terminalState.kind === 'error' ? 'alert' : 'status'"
      >
        <strong>{{ terminalState.title }}</strong>
        <span>{{ terminalState.detail }}</span>
      </div>

      <div
        v-if="(loading && value === undefined) || showSkeleton"
        class="dt-message-skeleton"
        role="status"
        aria-label="正在生成回复"
      >
        <span />
        <span />
        <span />
      </div>

      <template v-else-if="!terminalState || hasRenderableContent">
        <component v-if="renderer" :is="renderer" v-bind="rendererProps" />
        <slot
          v-else
          name="content"
          :entry="entry"
          section="output"
          :value="value"
          :default-renderer="ContentRenderer"
        >
          <ContentRenderer
            :value="value"
            :final="entry.status !== 'running'"
            :client="client"
            :tool-calls="toolCalls"
            :tool-renderers="toolRenderers"
          />
        </slot>
      </template>
    </template>
  </article>
</template>

<style scoped>
.dt-message-skeleton {
  display: grid;
  gap: 8px;
  width: min(560px, 88%);
  padding-block: 2px 5px;
}

.dt-message-skeleton span {
  display: block;
  height: 12px;
  border-radius: 5px;
  background: linear-gradient(90deg, #ffffff0a 20%, #ffffff18 45%, #ffffff0a 70%);
  background-size: 220% 100%;
  animation: dt-message-skeleton 1.35s ease-in-out infinite;
}

.dt-message-skeleton span:nth-child(2) {
  width: 86%;
}

.dt-message-skeleton span:nth-child(3) {
  width: 58%;
}

.dt-message-state-card {
  display: grid;
  gap: 3px;
  margin: 2px 0 4px;
  padding: 9px 11px;
  border: 1px solid var(--dt-border);
  border-radius: 7px;
  background: #ffffff06;
  color: var(--dt-muted);
  font-size: 11px;
}

.dt-message-state-card strong {
  color: var(--dt-text);
  font-size: 11px;
  font-weight: 600;
}

.dt-message-state-card[data-kind='error'] {
  border-color: color-mix(in srgb, #ff7188 42%, var(--dt-border));
  background: color-mix(in srgb, #ff7188 7%, transparent);
}

.dt-message-state-card[data-kind='error'] strong {
  color: #ffadb9;
}

.dt-message-state-card[data-kind='aborted'] {
  border-color: color-mix(in srgb, var(--dt-muted) 35%, var(--dt-border));
}

.dt-message-state-card[data-kind='warning'] {
  border-color: color-mix(in srgb, #f0b35a 36%, var(--dt-border));
  background: color-mix(in srgb, #f0b35a 6%, transparent);
}

.dt-message-state-card[data-kind='warning'] strong {
  color: #f2c078;
}

@keyframes dt-message-skeleton {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dt-message-skeleton span {
    animation: none;
  }
}
</style>
