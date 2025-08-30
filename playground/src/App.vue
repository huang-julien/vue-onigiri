<script setup lang="ts">
import { serializeComponent } from "vue-onigiri/runtime/serialize"
import Counter from "./components/Counter.vue";

const ast = await serializeComponent(Counter);
</script>


<template> 
  <main> 
    {{ ast }}
  </main>
</template>
 