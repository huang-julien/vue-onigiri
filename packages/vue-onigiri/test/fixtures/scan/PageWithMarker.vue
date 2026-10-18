<template>
  <div>
    <Counter v-load-client />
    <AutoWidget v-load-client />
  </div>
</template>

<script setup lang="ts">
import Counter from "../components/Counter.vue";
</script>
