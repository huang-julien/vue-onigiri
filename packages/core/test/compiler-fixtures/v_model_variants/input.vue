<script setup lang="ts">
import { ref } from "vue";

const text = ref("");
const age = ref(0);
const bio = ref("");
const agreed = ref(false);
const picked = ref("a");
</script>

<template>
  <form>
    <input v-model.trim="text" />
    <input v-model.number.lazy="age" type="number" />
    <textarea v-model="bio" />
    <input v-model="agreed" type="checkbox" />
    <select v-model="picked">
      <option value="a">A</option>
      <option value="b">B</option>
    </select>
  </form>
</template>
