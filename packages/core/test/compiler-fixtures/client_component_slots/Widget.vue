<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <div>
    <span>{{ label }}</span>
    <slot />
    <slot name="footer" />
  </div>
</template>
