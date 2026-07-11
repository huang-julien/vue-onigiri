<script setup>
const nullish = null;
const undef = undefined;
const obj = { a: 1 };
const num = 0;
</script>

<template>
  <div>
    <span>{{ nullish }}</span>
    <span>{{ undef }}</span>
    <span>{{ obj }}</span>
    <span>{{ num }}</span>
  </div>
</template>
