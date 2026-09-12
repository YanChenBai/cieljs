<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ events: readonly { id: number; time: string; text: string }[] }>();

// 倒叙展示：最新的事件落在最上面，不用每次滚到底部才能看到。
const newestFirst = computed(() => [...props.events].reverse());
</script>

<template>
  <section
    class="flex min-h-[100px] shrink-0 grow flex-col px-[18px] pt-3.5 pb-12 text-[11px]"
    aria-label="运行轨迹"
  >
    <div class="section-heading">运行轨迹</div>
    <p v-if="events.length === 0" class="hint">
      开始观看后，切房等操作记录与发送的弹幕会显示在这里。
    </p>
    <ol class="m-0 list-none p-0">
      <li
        v-for="event in newestFirst"
        :key="event.id"
        class="grid grid-cols-[52px_minmax(0,1fr)] gap-[7px] py-1.5 [overflow-wrap:anywhere]"
      >
        <time class="text-[#71717a]">{{ event.time }}</time
        ><span>{{ event.text }}</span>
      </li>
    </ol>
  </section>
</template>
