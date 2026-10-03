<script setup lang="ts">
import { resolveComponent } from "vue";

const pick = () => resolveComponent("GlobalFoo");
</script>

<template>
  <div class="render-time">
    <component :is="pick()" />
    <slot><component :is="pick()" label="fallback" /></slot>
  </div>
</template>
