<script setup lang="ts">
import MarkdownRender from 'markstream-vue';
import { computed } from 'vue';
import VueJsonPretty from 'vue-json-pretty';

import { readableText, imageSource } from './content-format.ts';
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

const formattedText = computed(() =>
  text.value === undefined ? undefined : readableText(text.value),
);

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
</script>
<template>
  <div class="dt-content">
    <MarkdownRender
      v-if="text !== undefined"
      :content="formattedText ?? ''"
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
