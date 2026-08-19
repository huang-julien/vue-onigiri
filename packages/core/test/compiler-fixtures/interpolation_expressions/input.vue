<script setup lang="ts">
import { ref } from "vue";

const count = ref(1);
const user = ref<{ name?: string } | null>(null);
const unit = "px";
const format = (value: number): string => `${value}${unit}`;
</script>

<template>
  <div>
    <span>{{ count > 0 ? "positive" : "zero" }}</span>
    <span>{{ format(count) }}</span>
    <span>{{ count * 2 + 1 }}</span>
    <span>{{ user?.name }}</span>
    <span>{{ `total: ${count}` }}</span>
    <span>{{ count }} of {{ unit }}</span>
  </div>
</template>
