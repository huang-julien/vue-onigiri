<template>
  <div>
    <Counter loadClientSide load:client>
      <template #default="{ count }">
        <div>
          <p>Slot to Counter: {{ count }}</p>
        </div>
      </template>
    </Counter>
  </div>
</template>

<script lang="ts" setup>
import Counter from "./Counter.vue";
</script>
