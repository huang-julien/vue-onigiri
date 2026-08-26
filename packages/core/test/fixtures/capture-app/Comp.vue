<script setup>
defineProps({ count: { type: Number, default: 5 } });
</script>

<template>
  <ul>
    <li v-for="n in count" :key="n">{{ n }}</li>
  </ul>
</template>
