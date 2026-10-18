<template>
  <section>
    <div v-if="shown">
      <deep-child v-load-client />
    </div>
  </section>
</template>

<script setup lang="ts">
import DeepChild from "../components/LoadComponent.vue";
const shown = true;
</script>
