<script setup lang="ts">
import type { DevtoolsClient } from '../client/index.ts';
import type { TraceEntry } from '../protocol/index.ts';
import ContentRenderer from './ContentRenderer.vue';
import { useTraceValue } from './useTraceValue.ts';
const props = defineProps<{ client: DevtoolsClient; entry: TraceEntry }>();
const { value, error } = useTraceValue(
  () => props.client,
  () => props.entry,
  () => 'output',
);
</script>
<template>
  <article class="dt-message">
    <header>
      <strong>
        {{
          entry.name === 'assistant'
            ? 'Ciel'
            : entry.name === 'user'
              ? '观察输入'
              : (entry.label ?? entry.name)
        }}
      </strong>
      <small>
        {{ entry.status === 'running' ? '生成中…' : entry.model?.name }}
      </small>
    </header>
    <p v-if="error" class="dt-error">{{ error }}</p>
    <slot
      v-else
      name="content"
      :entry="entry"
      section="output"
      :value="value"
      :default-renderer="ContentRenderer"
    >
      <ContentRenderer :value="value" :final="entry.status !== 'running'" />
    </slot>
  </article>
</template>
