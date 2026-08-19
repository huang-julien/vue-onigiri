<script setup lang="ts">
import { ref } from "vue";

const count = ref(0);
const submit = () => {};
const onEnter = () => {};
const eventName = ref("focus");
</script>

<template>
  <form @submit.prevent="submit">
    <input @keyup.enter="onEnter" @keydown.ctrl.enter="submit" />
    <button @click.stop.prevent="submit" @mouseenter="count++">Go</button>
    <button @click="count += 1" @dblclick="() => count--">Inline</button>
    <div @scroll.passive="submit" @[eventName]="submit" @click.self="submit" />
  </form>
</template>
