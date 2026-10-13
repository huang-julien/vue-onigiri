<template>
  <ul>
    <li v-for="i in width" :key="i">
      <Nested v-if="depth > 0" :depth="depth - 1" :width="width" />
      <span v-else>leaf {{ i }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import Nested from "./Nested.vue";

defineProps<{ depth: number; width: number }>();
</script>
