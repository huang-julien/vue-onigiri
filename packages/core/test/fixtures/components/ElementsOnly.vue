<template>
  <div>
    <div>1</div>
    <div>2</div>
    <div>{{ count }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
const count = ref(0);
</script>
