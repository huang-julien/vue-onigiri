<template>
    <div>
        injection: {{ injected }}
    </div>
</template>

<script lang="ts" setup>
import { inject } from 'vue'
const injected = inject('test')
</script>