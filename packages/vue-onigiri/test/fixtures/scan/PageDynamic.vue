<template>
  <component :is="comp" v-load-client />
</template>

<script setup lang="ts">
import { shallowRef } from "vue";
const comp = shallowRef(null);
</script>
