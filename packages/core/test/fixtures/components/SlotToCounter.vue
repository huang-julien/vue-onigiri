<template>
  <div>
    <Counter v-load-client>
      <div>
        <p>Slot content (static)</p>
      </div>
    </Counter>
  </div>
</template>

<script lang="ts" setup>
import Counter from "./Counter.vue";
</script>
