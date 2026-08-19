<script setup lang="ts">
import Counter from "./Counter.vue";
</script>

<template>
  <div>
    <Counter v-load-client :initial="5" />
  </div>
</template>
