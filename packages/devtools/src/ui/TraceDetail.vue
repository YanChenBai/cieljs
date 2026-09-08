<script setup lang="ts">
import { Button, Tabs } from '@vuetify/v0/components';
import { shallowRef, watch } from 'vue';

import type { DevtoolsClient } from '../client/index.ts';
import type { TraceEntry } from '../protocol/index.ts';
import ContentRenderer from './ContentRenderer.vue';
import Disclosure from './Disclosure.vue';
const props = defineProps<{ client: DevtoolsClient; entry: TraceEntry }>();
defineEmits<{ close: [] }>();
const tab = shallowRef('overview');
const sections = shallowRef<{ key: 'input' | 'output' | 'raw'; value: unknown }[]>([]);
const error = shallowRef('');
watch(
  () => [props.entry.id, props.entry.revision],
  async (_next, _old, onCleanup) => {
    let disposed = false;
    onCleanup(() => {
      disposed = true;
    });
    if (_next[0] !== _old?.[0]) sections.value = [];
    error.value = '';
    try {
      const values = await Promise.all(
        (['input', 'output', 'raw'] as const).map(async key => ({
          key,
          value: props.entry[key]
            ? await props.client.values.get({
                id: props.entry[key]!.id,
                path: props.entry[key]!.path,
              })
            : undefined,
        })),
      );
      if (!disposed) sections.value = values;
    } catch (cause) {
      if (!disposed) error.value = String(cause);
    }
  },
  { immediate: true },
);
const tabs = [
  { value: 'overview', label: '概览' },
  { value: 'input', label: '输入' },
  { value: 'output', label: '输出' },
  { value: 'raw', label: '原始事件' },
];
</script>
<template>
  <div class="dt-detail">
    <Tabs.Root v-model="tab">
      <div class="dt-detail-toolbar">
        <Button.Root class="dt-button dt-close" aria-label="关闭详情" @click="$emit('close')">
          ×
        </Button.Root>
        <Tabs.List class="dt-tabs" aria-label="步骤详情">
          <Tabs.Item v-for="item in tabs" :key="item.value" :value="item.value" class="dt-tab">
            {{ item.label }}
          </Tabs.Item>
        </Tabs.List>
      </div>
      <p v-if="error" class="dt-error">{{ error }}</p>
      <Tabs.Panel value="overview" class="dt-detail-body">
        <Disclosure title="General">
          <dl>
            <dt>步骤</dt>
            <dd>{{ entry.name }}</dd>
            <dt>名称</dt>
            <dd>{{ entry.label ?? entry.name }}</dd>
            <dt>状态</dt>
            <dd>{{ entry.status }}</dd>
            <dt>时间</dt>
            <dd>{{ new Date(entry.startedAt).toLocaleTimeString() }}</dd>
            <dt>记录 ID</dt>
            <dd>{{ entry.id }}</dd>
            <dt>Session</dt>
            <dd>{{ entry.sessionId }}</dd>
            <dt>Run</dt>
            <dd>{{ entry.runId }}</dd>
            <dt>Turn</dt>
            <dd>{{ entry.turnId }}</dd>
            <dt v-if="entry.toolCallId">Tool call</dt>
            <dd v-if="entry.toolCallId">{{ entry.toolCallId }}</dd>
            <dt v-if="entry.messageId">Message</dt>
            <dd v-if="entry.messageId">{{ entry.messageId }}</dd>
          </dl>
        </Disclosure>
        <Disclosure v-if="entry.kind === 'tool'" title="工具">
          <ContentRenderer
            :value="{
              label: entry.label,
              description: entry.description,
              toolCallId: entry.toolCallId,
            }"
          />
        </Disclosure>
        <Disclosure v-if="entry.model" title="模型">
          <ContentRenderer :value="entry.model" />
        </Disclosure>
      </Tabs.Panel>
      <Tabs.Panel
        v-for="section in sections"
        :key="section.key"
        :value="section.key"
        class="dt-detail-body dt-payload"
      >
        <p v-if="section.value === undefined" class="dt-empty">此步骤没有该内容</p>
        <slot
          v-else
          name="content"
          :entry="entry"
          :section="section.key"
          :value="section.value"
          :default-renderer="ContentRenderer"
        >
          <ContentRenderer :value="section.value" />
        </slot>
      </Tabs.Panel>
    </Tabs.Root>
  </div>
</template>
