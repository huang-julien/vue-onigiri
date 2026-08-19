<script setup lang="ts">
import { ref } from "vue";

const visible = ref(true);
const html = ref("<b>hi</b>");
const label = ref("label");
const frozen = ref("frozen");
</script>

<template>
  <div v-cloak>
    <p v-show="visible">Shown</p>
    <div v-html="html" />
    <span v-text="label" />
    <span v-once>{{ frozen }}</span>
    <span v-pre>{{ raw }}</span>
  </div>
</template>
