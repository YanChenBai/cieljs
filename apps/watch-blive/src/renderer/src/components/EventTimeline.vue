<script setup lang="ts">
import { vFollowScroll } from '@cieljs/devtools';

defineProps<{ events: readonly { id: number; time: string; text: string }[] }>();
</script>

<template>
  <section
    class="flex min-h-[100px] flex-1 flex-col overflow-hidden px-[18px] py-3.5 text-[11px]"
    aria-label="运行轨迹"
  >
    <div class="section-heading">运行轨迹</div>
    <p v-if="events.length === 0" class="hint">开始观看后，探索、思考与互动会显示在这里。</p>
    <ol
      v-follow-scroll
      class="m-0 max-h-[40vh] min-h-0 list-none overflow-y-auto overscroll-contain p-0"
    >
      <li
        v-for="event in events"
        :key="event.id"
        class="grid grid-cols-[52px_minmax(0,1fr)] gap-[7px] py-1.5 [overflow-wrap:anywhere]"
      >
        <time class="text-[#71717a]">{{ event.time }}</time
        ><span>{{ event.text }}</span>
      </li>
    </ol>
  </section>
</template>
