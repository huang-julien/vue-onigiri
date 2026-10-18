<template>
  <div>
    <div>1</div>
    <div>2</div>
    <Counter v-load-client />
    <UiButton v-load-client />
  </div>
</template>

<script setup lang="ts">
import Counter from "./Counter.vue";
import UiButton from "vue-onigiri-test-ui-lib/Button.vue";
</script>
