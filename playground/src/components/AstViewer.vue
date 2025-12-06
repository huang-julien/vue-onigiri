<template>
    <code style="white-space: pre;">
        {{ JSON.stringify(ast, null, 2) }}
    </code>
</template>

<script setup lang="ts">
import type { VNode } from 'vue';
import { computedAsync } from "@vueuse/core"
import { serializeVNode, unrollServerComponentBufferPromises, serializeApp, serializeComponent } from "vue-onigiri/runtime/serialize"
import type { VServerComponentBuffered } from 'vue-onigiri/runtime/shared';
import { loadClientDirective } from 'vue-onigiri/runtime/utils';
import LoadComponent from './LoadComponent.vue';
const props = defineProps<{
    vnode?: VNode
}>()

const ast = computedAsync(() => {
    const vnode = props.vnode
    if(!vnode) return null 
    return unrollServerComponentBufferPromises(serializeComponent(LoadComponent) as Promise<VServerComponentBuffered>)
})
</script>
