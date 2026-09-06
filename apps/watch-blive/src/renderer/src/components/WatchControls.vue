<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { LoaderCircle, Play, Square } from "lucide-vue-next";
import { Button } from "@vuetify/v0/components";
import type { LiveArea, StartWatchOptions, WatchMode } from "../../../shared/types.ts";

const props = defineProps<{
  areas: readonly LiveArea[];
  active: boolean;
  pending: string;
  ready: boolean;
}>();
const emit = defineEmits<{
  start: [options: StartWatchOptions];
  stop: [];
}>();
const mode = shallowRef<WatchMode["type"]>("follow");
const roomId = shallowRef<number>();
const areaId = shallowRef<number>();
const live = shallowRef(false);
const areaSearch = shallowRef("");
const filteredAreas = computed(() => {
  const query = areaSearch.value.trim().toLocaleLowerCase();
  return props.areas
    .map((group) => ({
      ...group,
      children: group.children.filter((area) =>
        `${group.name} ${area.name} ${area.id}`.toLocaleLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.children.length > 0 || group.name.toLocaleLowerCase().includes(query));
});
const valid = computed(
  () =>
    Number.isSafeInteger(mode.value === "follow" ? roomId.value : areaId.value) &&
    (mode.value === "follow" ? roomId.value! : areaId.value!) > 0,
);
function start() {
  if (!valid.value || !props.ready || props.pending || props.active) return;
  emit("start", {
    mode:
      mode.value === "follow"
        ? { type: "follow", roomId: roomId.value! }
        : { type: "explore", areaId: areaId.value! },
    danmakuDelivery: live.value ? "live" : "simulate",
  });
}
</script>

<template>
  <section class="controls">
    <div class="section-heading">观看设置</div>
    <form @submit.prevent="start">
      <fieldset :disabled="active || !!pending">
        <label
          >观看模式<select v-model="mode">
            <option value="follow">单推 · 只看这位主播</option>
            <option value="explore">探索 · 发现感兴趣的直播</option>
          </select></label
        >
        <label v-if="mode === 'follow'"
          >直播间 roomId<input
            v-model.number="roomId"
            type="number"
            min="1"
            step="1"
            required
            placeholder="输入直播间号"
        /></label>
        <template v-else>
          <label
            >搜索分区
            <input
              v-model="areaSearch"
              type="search"
              placeholder="分区名称或编号"
              @input="areaId = undefined"
            />
          </label>
          <label
            >直播分区
            <select v-model="areaId" required>
              <option :value="undefined" disabled>选择分区</option>
              <optgroup v-for="group in filteredAreas" :key="group.id" :label="group.name">
                <option :value="group.id">全部{{ group.name }}</option>
                <option v-for="area in group.children" :key="area.id" :value="area.id">
                  {{ area.name }}
                </option>
              </optgroup>
            </select>
          </label>
          <p v-if="filteredAreas.length === 0" class="hint">没有匹配的分区，试试其他关键词。</p>
        </template>
        <label class="check"><input v-model="live" type="checkbox" />真实发送弹幕</label>
        <p class="hint">
          {{
            live ? "弹幕将发送到当前直播间，需要先登录。" : "默认模拟互动，不会向直播间发送弹幕。"
          }}
        </p>
      </fieldset>
      <Button.Root
        v-if="!active || pending === 'start'"
        class="action primary"
        @click="start"
        :disabled="!ready || !!pending || !valid"
        :aria-busy="pending === 'start'"
        ><LoaderCircle v-if="pending === 'start'" class="spinning" :size="16" /><Play
          v-else
          :size="16"
        />{{ pending === "start" ? "正在启动…" : "开始观看" }}</Button.Root
      >
      <Button.Root
        v-else
        class="action stop-action"
        type="button"
        :disabled="pending === 'stop'"
        :aria-busy="pending === 'stop'"
        @click="emit('stop')"
        ><LoaderCircle v-if="pending === 'stop'" class="spinning" :size="16" /><Square
          v-else
          :size="16"
        />{{ pending === "stop" ? "正在停止…" : "停止观看" }}</Button.Root
      >
    </form>
  </section>
</template>
