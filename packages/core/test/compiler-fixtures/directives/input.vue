<script setup lang="ts">
import { ref } from "vue";

const show = ref(true);
const items = ref(["a", "b", "c"]);
const text = ref("");
</script>

<template>
  <div>
    <p v-if="show">Visible</p>
    <p v-else>Hidden</p>
    <ul>
      <li v-for="item in items" :key="item">{{ item }}</li>
    </ul>
    <input v-model="text" />
  </div>
</template>
