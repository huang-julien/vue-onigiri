<script setup lang="ts">
import LoadComponent from "./components/LoadComponent.vue";
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>🍙 Vue Onigiri Playground</h1>
      <p>HTML-first Vue islands</p>
    </header>

    <main class="content">
      <div class="panel">
        <h2>Live Component</h2>
        <p class="description">
          In a client build <code>v-load-client</code> is dropped by the compiler transform, so the
          island renders as a plain component. Server builds mark it for <code>domToVNode</code>.
        </p>
        <LoadComponent />
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
.content {
  padding: 24px;
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
</style>
