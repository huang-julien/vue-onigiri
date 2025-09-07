<template>
    <code style="white-space: pre;">
        {{ JSON.stringify(ast, null, 2) }}
    </code>
</template>

<script setup lang="ts">
import type { VNode } from 'vue';
import { computedAsync } from "@vueuse/core"
import { serializeVNode, unrollServerComponentBufferPromises } from "vue-onigiri/runtime/serialize"
import type { VServerComponentBuffered } from 'vue-onigiri/runtime/shared';
const props = defineProps<{
    vnode?: VNode
}>()

const ast = computedAsync(() => {
    unrollServerComponentBufferPromises(serializeVNode(props.vnode) as Promise<VServerComponentBuffered>).then(r =>  {
        console.log(r)
    })
    return unrollServerComponentBufferPromises(serializeVNode(props.vnode) as Promise<VServerComponentBuffered>)
})
</script>
