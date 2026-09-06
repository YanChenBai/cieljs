<script setup lang="ts">
import { vFollowScroll } from "@cieljs/devtools";
defineProps<{ events: readonly { id: number; time: string; text: string }[] }>();
</script>
<template>
  <section class="timeline" aria-label="运行轨迹">
    <div class="section-heading">运行轨迹</div>
    <p v-if="events.length === 0" class="hint">开始观看后，探索、思考与互动会显示在这里。</p>
    <ol v-follow-scroll>
      <li v-for="event in events" :key="event.id">
        <time>{{ event.time }}</time
        ><span>{{ event.text }}</span>
      </li>
    </ol>
  </section>
</template>
