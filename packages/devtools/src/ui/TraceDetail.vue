<script setup lang="ts">
import { Button, Tabs } from '@vuetify/v0/components';
import { shallowRef } from 'vue';

import type { DevtoolsClient } from '../client/index.ts';
import type { TraceEntry } from '../protocol/index.ts';
import ContentRenderer from './ContentRenderer.vue';
import Disclosure from './Disclosure.vue';
import { useTraceValue, type TraceSection } from './useTraceValue.ts';
const props = defineProps<{ client: DevtoolsClient; entry: TraceEntry }>();
defineEmits<{ close: [] }>();
const tab = shallowRef<TraceSection | 'overview'>('overview');
const sections = ['input', 'output', 'raw'] as const;
const { value, error, loading } = useTraceValue(
  () => props.client,
  () => props.entry,
  () => (tab.value === 'overview' ? undefined : tab.value),
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
        :key="section"
        :value="section"
        class="dt-detail-body dt-payload"
      >
        <template v-if="tab === section">
          <p v-if="loading" class="dt-empty">加载中…</p>
          <p v-else-if="value === undefined" class="dt-empty">此步骤没有该内容</p>
          <slot
            v-else
            name="content"
            :entry="entry"
            :section="section"
            :value="value"
            :default-renderer="ContentRenderer"
          >
            <ContentRenderer :value="value" />
          </slot>
        </template>
      </Tabs.Panel>
    </Tabs.Root>
  </div>
</template>
