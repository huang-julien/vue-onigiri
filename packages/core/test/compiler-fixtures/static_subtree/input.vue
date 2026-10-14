<script setup lang="ts">
import { ref } from "vue";

const count = ref(0);
const selected = ref("a");
</script>

<template>
  <header><strong>Static header</strong><br /><img src="/logo.png" alt="Logo" /></header>
  <p>{{ count }}</p>
  before<span title="&lt;&amp;&quot;">&lt; &amp; &quot;</span>after
  <div unknown="value">Tuple</div>
  <table><tr><td>Cell</td></tr></table>
  <select v-model="selected">
    <option value="a">A</option>
    <option value="b">B</option>
  </select>
  <pre>first
  second &lt; &amp;</pre>
  <svg viewBox="0 0 10 10"><path d="M0 0 L10 10" stroke-width="2" /></svg>
</template>
