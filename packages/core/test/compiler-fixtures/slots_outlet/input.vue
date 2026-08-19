<script setup lang="ts">
import { ref } from "vue";

const item = ref({ id: 1 });
const dynamicName = ref("row");
</script>

<template>
  <div>
    <slot />
    <slot name="header" />
    <slot name="footer">Default footer</slot>
    <slot name="row" :item="item" :index="0" />
    <slot :name="dynamicName" />
  </div>
</template>
