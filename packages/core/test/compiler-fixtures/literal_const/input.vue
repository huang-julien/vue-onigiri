<script setup lang="ts">
const TITLE = "Onigiri";
const VERSION = 4;
const ENABLED = true;
</script>

<template>
  <div :data-version="VERSION" :data-enabled="ENABLED">{{ TITLE }}</div>
</template>
