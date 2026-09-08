<script setup lang="ts">
import { Button } from '@vuetify/v0/components';
import { Download, LoaderCircle } from 'lucide-vue-next';
import { computed } from 'vue';

import type { HearingModelStatus, WatchConfigurationStatus } from '../../../shared/types.ts';

const props = defineProps<{
  configuration?: WatchConfigurationStatus;
  models?: HearingModelStatus;
  pending: string;
}>();

const downloadLabel = computed(() => {
  if (props.models?.installing || props.pending === 'install-models') return '正在下载模型…';
  if (props.models?.error) return '重试下载';
  return '下载听觉模型';
});

const emit = defineEmits<{ installModels: [] }>();
</script>

<template>
  <section
    v-if="!configuration?.valid || !models?.valid"
    class="border-b border-[#ffffff0b] px-[18px] py-4"
  >
    <div class="section-heading">运行配置</div>
    <div
      v-if="!configuration?.valid"
      class="my-2 rounded-lg bg-[#442936] px-3 py-2 text-[11px] leading-[1.6] text-[#ffc1d2]"
    >
      <p class="m-0">{{ configuration?.message || '正在检查配置…' }}</p>
    </div>

    <template v-if="!models?.valid">
      <p class="hint">
        {{ models ? `缺少 ${models.missingFiles.length} 个模型文件` : '正在检查听觉模型…' }}
      </p>
      <div v-if="models?.progress" class="hint break-all" role="status">
        <div>{{ models.progress.file }} · 第 {{ models.progress.attempt || 1 }} 次尝试</div>
        <div>
          {{ (models.progress.receivedBytes / 1048576).toFixed(1) }} MB
          <template v-if="models.progress.totalBytes">
            / {{ (models.progress.totalBytes / 1048576).toFixed(1) }} MB</template
          >
        </div>
        <progress
          class="w-full"
          :value="models.progress.totalBytes ? models.progress.receivedBytes : undefined"
          :max="models.progress.totalBytes"
          aria-label="当前模型下载进度"
        />
        <p v-if="models.progress.message">{{ models.progress.message }}，正在重试…</p>
      </div>
      <p v-if="models?.error" class="text-[11px] break-all text-[#ffc1d2]" role="alert">
        {{ models.error }}
      </p>
      <Button.Root
        class="action w-full justify-center !bg-[#442936] !text-[#ffc1d2]"
        type="button"
        :disabled="!!models?.installing || !!pending"
        :aria-busy="models?.installing || pending === 'install-models'"
        @click="emit('installModels')"
      >
        <LoaderCircle
          v-if="models?.installing || pending === 'install-models'"
          class="spinning"
          :size="16"
        />
        <Download v-else :size="16" />
        {{ downloadLabel }}
      </Button.Root>
    </template>
  </section>
</template>
