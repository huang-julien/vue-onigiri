<template>
  <ul>
    <li v-for="row in rows" :key="row.id" :class="row.odd ? 'odd' : 'even'">
      <span>{{ row.id }}</span>
      <span>{{ row.label }}</span>
      <Counter v-if="row.client" v-load-client :start="row.id" />
    </li>
  </ul>
</template>

<script setup lang="ts">
import Counter from "./Counter.vue";

const props = withDefaults(defineProps<{ count: number; every: number; label?: string }>(), {
  label: "row",
});

// `Tree.vue` plus one client component every `every` rows, so the HTML carries markers.
const rows = Array.from({ length: props.count }, (_, i) => ({
  id: i,
  label: `${props.label} ${i}`,
  odd: i % 2 === 1,
  client: i % props.every === 0,
}));
</script>
