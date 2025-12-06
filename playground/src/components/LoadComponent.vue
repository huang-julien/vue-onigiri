<template>
  <div>
    <div>1</div>
    <div>2</div>
    <Counter v-load-client />
  </div>
</template>

<script setup lang="ts">
import { loadClientDirective } from "vue-onigiri/runtime/utils";
import Counter from "./Counter.vue";
import TsSlot from "./TsSlot";
const vLoadClient = loadClientDirective
</script>
