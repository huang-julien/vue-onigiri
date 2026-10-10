<template>
  <ul>
    <li v-for="row in rows" :key="row.id" :class="row.odd ? 'odd' : 'even'">
      <span>{{ row.id }}</span>
      <span>{{ row.label }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
const props = defineProps<{ count: number }>();

// Roughly five VNodes per row: li, two spans, two text nodes.
const rows = Array.from({ length: props.count }, (_, i) => ({
  id: i,
  label: `row ${i}`,
  odd: i % 2 === 1,
}));
</script>
