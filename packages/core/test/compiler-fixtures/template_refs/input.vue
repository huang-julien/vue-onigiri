<script setup lang="ts">
import { ref } from "vue";

const el = ref<HTMLElement | null>(null);
const name = ref("dyn");
</script>

<template>
  <div>
    <p ref="el">static ref</p>
    <p :ref="name">dynamic ref</p>
  </div>
</template>
