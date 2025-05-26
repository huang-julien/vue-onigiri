<template>
  <div>
    component with suspense

    <Suspense>
      <AsyncComponent v="yolo" />
    </Suspense>
  </div>
</template>

<script setup lang="ts">
import AsyncComponent from "./AsyncComponent.vue";
</script>
