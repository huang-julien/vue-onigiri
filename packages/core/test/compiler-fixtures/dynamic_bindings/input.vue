<script setup lang="ts">
import { ref } from "vue";

const id = ref("box");
const isActive = ref(true);
const extra = ref("extra");
const color = ref("red");
const attrs = ref({ role: "note" });
const attrName = ref("data-kind");
const styles = ref({ margin: 0 });
</script>

<template>
  <div :id="id" :class="{ active: isActive }" :style="{ color: color }">
    <span :class="['base', extra]" />
    <span v-bind="attrs" :title="extra" />
    <span :[attrName]="extra" />
    <span :id />
    <span class="static" :class="extra" style="color: red" :style="styles" />
  </div>
</template>
