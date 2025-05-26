<template>
    <div>
        counter : {{ count }}
        <button @click="increment">Increment</button>

        <slot :count="count" />
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
const increment = () => {
    count.value++
}
</script>