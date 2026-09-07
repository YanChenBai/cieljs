<script setup lang="ts">
import { shallowRef } from "vue";
import { Collapsible } from "@vuetify/v0/components";
const props = withDefaults(defineProps<{ title: string; defaultOpen?: boolean }>(), {
  defaultOpen: true,
});
const open = shallowRef(props.defaultOpen);
</script>
<template>
  <Collapsible.Root v-model="open" class="dt-section">
    <Collapsible.Activator class="dt-disclosure">
      <Collapsible.Cue class="dt-cue">›</Collapsible.Cue>
      {{ title }}
    </Collapsible.Activator>
    <Collapsible.Content class="dt-section-content"><slot /></Collapsible.Content>
  </Collapsible.Root>
</template>
