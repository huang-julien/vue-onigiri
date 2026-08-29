<script setup lang="ts">
const label = "scoped";
</script>

<template>
  <div class="scoped-root">{{ label }}</div>
</template>

<style scoped>
.scoped-root {
  color: red;
}
</style>
