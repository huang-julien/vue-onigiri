<script setup lang="ts">
import { ref } from "vue";

const label = "Counter";
const count = ref(0);
const increment = () => {
  count.value++;
};
</script>

<template>
  <div class="counter">
    <span>{{ label }}</span>
    <button :class="{ active: count > 0 }" @click="increment">{{ count }}</button>
  </div>
</template>
