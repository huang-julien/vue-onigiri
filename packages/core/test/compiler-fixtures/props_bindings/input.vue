<script setup lang="ts">
const props = defineProps<{ title: string; count?: number }>();
const emit = defineEmits<{ (e: "change", value: number): void }>();
</script>

<template>
  <div>
    <h1>{{ title }}</h1>
    <span>{{ props.count }}</span>
    <button @click="emit('change', 1)">emit</button>
  </div>
</template>
