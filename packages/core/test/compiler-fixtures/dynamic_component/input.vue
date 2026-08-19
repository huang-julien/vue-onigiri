<script setup lang="ts">
import { ref, shallowRef } from "vue";
import Panel from "./Panel.vue";

const current = shallowRef(Panel);
const title = ref("a");
</script>

<template>
  <div>
    <component :is="current" :title="title">
      <p>slotted</p>
    </component>
    <component is="Panel" />
  </div>
</template>
