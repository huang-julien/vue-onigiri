<script setup lang="ts">
import { ref } from "vue";

const status = ref("loading");
const show = ref(true);
</script>

<template>
  <div>
    <p v-if="status === 'loading'">Loading</p>
    <p v-else-if="status === 'error'">Error</p>
    <p v-else>Ready</p>
    <template v-if="show">
      <h2>Title</h2>
      <p>Body</p>
    </template>
    <span v-if="show">Only when shown</span>
  </div>
</template>
