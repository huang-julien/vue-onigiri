<script setup lang="ts">
import { ref } from "vue";

const clicks = ref(0);
</script>

<template>
  <button class="ui-lib-button" @click="clicks++">UI Lib Button: {{ clicks }}</button>
</template>
