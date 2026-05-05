<script setup lang="ts">
import { ref, computed, type VNode } from "vue";
import AstViewer from "./components/AstViewer.vue";
import Counter from "./components/Counter.vue";
import LoadComponent from "./components/LoadComponent.vue";

const vnode = ref();
const activeTab = ref<"live" | "compiled">("live");

function onVnodeUpdated(_vnode: VNode) {
  vnode.value = _vnode;
}

// Access the compile-time onigiri render attached by the plugin
const compiledAst = computed(() => {
  const onigiriRender = (LoadComponent as any).__onigiriRender;
  if (onigiriRender) {
    return onigiriRender({}, {});
  }
  return null;
});
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>🍙 Vue Onigiri Playground</h1>
      <p>Vue Server Components - VNode Serialization</p>
    </header>

    <nav class="tabs">
      <button :class="{ active: activeTab === 'live' }" @click="activeTab = 'live'">
        Live + Runtime AST
      </button>
      <button :class="{ active: activeTab === 'compiled' }" @click="activeTab = 'compiled'">
        Compiled AST
      </button>
    </nav>

    <main class="content">
      <div v-if="activeTab === 'live'" class="panel-grid">
        <div class="panel">
          <h2>Live Component</h2>
          <LoadComponent
            ref="counterRef"
            @vue:mounted="onVnodeUpdated"
            @vue:updated="onVnodeUpdated"
          />
        </div>
        <div class="panel">
          <h2>Runtime VNode AST</h2>
          <AstViewer ref="astViewerRef" :vnode="vnode" />
        </div>
      </div>

      <div v-else-if="activeTab === 'compiled'" class="panel">
        <h2>Compile-time Serialized AST</h2>
        <p class="description">
          Pre-compiled via <code>LoadComponent.__onigiriRender()</code> - automatically attached by
          the Vite plugin
        </p>
        <pre class="ast">{{ JSON.stringify(compiledAst, null, 2) }}</pre>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
}
.header {
  padding: 24px;
  text-align: center;
  border-bottom: 1px solid var(--color-border);
}
.header h1 {
  margin: 0 0 8px 0;
}
.header p {
  margin: 0;
  opacity: 0.7;
}
.tabs {
  display: flex;
  gap: 8px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--color-border);
}
.tabs button {
  padding: 8px 16px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
}
.tabs button:hover {
  background: var(--color-background-soft);
}
.tabs button.active {
  background: var(--color-background-mute);
  border-color: var(--vt-c-green);
}
.content {
  padding: 24px;
}
.panel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
.panel {
  background: var(--color-background-soft);
  border-radius: 8px;
  padding: 16px;
  border: 1px solid var(--color-border);
}
.panel h2 {
  margin: 0 0 16px 0;
  font-size: 1.1rem;
}
.description {
  opacity: 0.7;
  margin-bottom: 16px;
}
.description code {
  background: var(--color-background-mute);
  padding: 2px 6px;
  border-radius: 4px;
}
.ast {
  background: var(--color-background-mute);
  padding: 16px;
  border-radius: 8px;
  overflow: auto;
  max-height: 600px;
  font-size: 12px;
  line-height: 1.5;
}
</style>
