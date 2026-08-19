<script setup lang="ts">
import { ref } from "vue";

const target = ref("#modal");
const disabled = ref(false);
</script>

<template>
  <div>
    <Teleport to="#modal"><p>static target</p></Teleport>
    <Teleport :to="target" :disabled="disabled"><p>dynamic target</p></Teleport>
    <KeepAlive><p>kept</p></KeepAlive>
    <Transition name="fade"><p>faded</p></Transition>
    <TransitionGroup tag="ul"><li>one</li></TransitionGroup>
    <Suspense>
      <template #default><p>content</p></template>
      <template #fallback><p>loading</p></template>
    </Suspense>
  </div>
</template>
