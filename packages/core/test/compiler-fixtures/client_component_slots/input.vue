<script setup lang="ts">
import Widget from "./Widget.vue";
</script>

<template>
  <Widget v-load-client label="boxed">
    <p>body</p>
    <em>more body</em>
    <template #footer><span>footer</span></template>
  </Widget>
</template>
