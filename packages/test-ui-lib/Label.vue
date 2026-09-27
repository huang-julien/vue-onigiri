<script setup lang="ts">
import { formatLabel } from "@vue-onigiri/test-ui-dep";

defineProps<{ text: string }>();
</script>

<template>
  <span class="ui-lib-label">{{ formatLabel(text) }}</span>
</template>
