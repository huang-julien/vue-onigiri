<script lang="ts">
export default {
  data() {
    return { count: 0, label: "hits" };
  },
  methods: {
    increment(): void {
      this.count++;
    },
  },
};
</script>

<template>
  <button @click="increment">{{ label }}: {{ count }}</button>
</template>
