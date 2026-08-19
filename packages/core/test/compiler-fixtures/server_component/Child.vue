<script setup lang="ts">
defineProps<{ title: string; count?: number }>();
</script>

<template>
  <section>
    <h2>{{ title }}</h2>
    <slot />
    <slot name="footer" />
    <slot name="row" :item="{ id: 1 }" />
  </section>
</template>
