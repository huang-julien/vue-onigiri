<script setup lang="ts">
import { ref } from "vue";

const vFocus = { mounted: (el: HTMLElement) => el.focus() };
const color = ref("red");
</script>

<template>
  <div>
    <input v-focus />
    <p v-highlight.lazy.deep="color">modifiers</p>
    <p v-color:background="color">argument</p>
  </div>
</template>
