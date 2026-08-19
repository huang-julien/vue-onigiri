<script setup lang="ts">
import { ref } from "vue";

const items = ref([{ id: 1, label: "a", tags: ["x"] }]);
const record = ref<Record<string, string>>({ a: "1" });
</script>

<template>
  <div>
    <ul>
      <li v-for="(item, index) in items" :key="item.id">{{ index }} - {{ item.label }}</li>
    </ul>
    <dl>
      <dt v-for="(value, key, index) in record" :key="key">{{ key }}:{{ value }}:{{ index }}</dt>
    </dl>
    <span v-for="n in 3" :key="n">{{ n }}</span>
    <template v-for="item in items" :key="item.id">
      <b>{{ item.label }}</b>
      <i v-for="tag in item.tags" :key="tag">{{ tag }}</i>
    </template>
  </div>
</template>
