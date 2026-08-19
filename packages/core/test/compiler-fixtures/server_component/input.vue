<script setup lang="ts">
import { ref } from "vue";
import Child from "./Child.vue";

const title = ref("hello");
</script>

<template>
  <Child :title="title" count="2">
    <p>default content</p>
    <template #footer><span>footer</span></template>
    <template #row="{ item }">{{ item.id }}</template>
  </Child>
</template>
