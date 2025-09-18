<script setup lang="ts"> 
import { ref, type VNode } from "vue";
import AstViewer from "./components/AstViewer.vue";
import Counter from "./components/Counter.vue";
import LoadComponent from "./components/LoadComponent.vue";
const vnode = ref()

function onVnodeUpdated(_vnode: VNode) {
  vnode.value = _vnode
}
</script>


<template> 
  <main style="display: grid; grid-template-columns: 1fr 1fr ; gap: 16px;">
    <LoadComponent ref="counterRef" @vue:mounted="onVnodeUpdated" @vue:updated="onVnodeUpdated">
       </LoadComponent>
    <AstViewer  ref="astViewerRef" :vnode="vnode" />
  </main>
</template>
 