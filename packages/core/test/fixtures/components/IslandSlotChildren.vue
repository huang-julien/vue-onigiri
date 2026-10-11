<template>
  <div>
    <Counter v-load-client>
      <ElementsOnly />
      <Counter v-load-client>
        <ElementsOnly />
      </Counter>
    </Counter>
  </div>
</template>

<script lang="ts" setup>
import Counter from "./Counter.vue";
import ElementsOnly from "./ElementsOnly.vue";
</script>
