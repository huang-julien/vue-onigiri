<template>
  <button @click="count++">{{ count }}</button>
</template>

<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ start: number }>();

const count = ref(props.start);
</script>
