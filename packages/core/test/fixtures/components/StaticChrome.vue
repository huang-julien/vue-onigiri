<template>
  <section class="static-chrome">
    <header class="static-chrome__header">
      <h1>Static title &amp; navigation</h1>
      <nav>
        <a href="/docs">Docs</a>
        <a href="/support">Support</a>
      </nav>
    </header>

    before<!-- split -->after<span>Static sibling</span>

    <p class="static-chrome__status">Local count: {{ count }}</p>

    <Counter v-load-client />

    <footer class="static-chrome__footer">
      <small>Static footer &copy; Onigiri</small>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Counter from "./Counter.vue";

const count = ref(7);
</script>
