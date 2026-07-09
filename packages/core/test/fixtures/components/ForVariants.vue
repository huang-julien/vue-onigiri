<script setup>
const obj = { a: 1, b: 2 };
const count = 3;
</script>

<template>
  <div>
    <li v-for="(v, k) in obj" :key="k">{{ k }}={{ v }}</li>
    <i v-for="n in count" :key="n">{{ n }}</i>
  </div>
</template>
