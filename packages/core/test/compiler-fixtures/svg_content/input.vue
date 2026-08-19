<script setup lang="ts">
import { ref } from "vue";

const radius = ref(10);
</script>

<template>
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" :r="radius" fill="currentColor" />
    <path d="M0 0 L10 10" stroke-width="2" />
  </svg>
</template>
