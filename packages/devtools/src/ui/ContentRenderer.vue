<script setup lang="ts">
import MarkdownRender from 'markstream-vue';
import { computed } from 'vue';
import VueJsonPretty from 'vue-json-pretty';

import Disclosure from './Disclosure.vue';

const props = withDefaults(defineProps<{ value: unknown; final?: boolean }>(), { final: true });
const text = computed(() => {
  const value = props.value;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'content' in value && typeof value.content === 'string')
    return value.content;
  return undefined;
});

const blocks = computed(() => {
  const value = props.value;
  if (!value || typeof value !== 'object') return [];
  if ('type' in value && value.type === 'image') return [value];
  if ('content' in value && Array.isArray(value.content)) return value.content;
  return [];
});

const json = computed(() => {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(props.value ?? null, (_key, value) => {
      if (typeof value === 'bigint') return String(value);
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    }),
  );
});

// 仅格式化完整独立的 JSON 行，保留原始消息与已有 Markdown 代码块。
function readableText(value: string) {
  let fenced = false;

  return value
    .split('\n')
    .map(line => {
      if (line.trimStart().startsWith('```')) {
        fenced = !fenced;
        return line;
      }
      const trimmed = line.trim();
      if (fenced || !/^[[{]/.test(trimmed)) return line;
      try {
        const data = JSON.parse(trimmed);
        if (!data || typeof data !== 'object') return line;
        return '\n```json\n' + JSON.stringify(data, null, 2) + '\n```\n';
      } catch {
        return line;
      }
    })
    .join('\n');
}

function imageSource(block: Record<string, unknown>) {
  if (
    typeof block.mimeType !== 'string' ||
    !/^image\/(png|jpeg|webp|gif)$/.test(block.mimeType) ||
    typeof block.data !== 'string'
  ) {
    return undefined;
  }

  return `data:${block.mimeType};base64,${block.data}`;
}
</script>
<template>
  <div class="dt-content">
    <MarkdownRender
      v-if="text !== undefined"
      :content="readableText(text)"
      :is-dark="true"
      html-policy="escape"
      :final="final"
    />
    <template v-else-if="blocks.length">
      <template v-for="(block, index) in blocks" :key="index">
        <img
          v-if="block.type === 'image'"
          :src="imageSource(block)"
          class="dt-image"
          alt="消息图片"
          loading="lazy"
        />
        <MarkdownRender
          v-else-if="block.type === 'text'"
          :content="readableText(block.text)"
          :is-dark="true"
          html-policy="escape"
          :final="final"
        />
        <Disclosure v-else-if="block.type === 'thinking'" title="思考">
          <MarkdownRender
            :content="block.thinking"
            :is-dark="true"
            html-policy="escape"
            :final="final"
          />
        </Disclosure>
        <VueJsonPretty v-else :data="block" :deep="2" theme="dark" />
      </template>
    </template>
    <VueJsonPretty v-else :data="json" :deep="3" theme="dark" />
  </div>
</template>
