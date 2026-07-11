import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parse, compileScript } from "@vue/compiler-sfc";
import type { ResolvedConfig } from "vite";
import { compileOnigiriInline } from "../src/template-compiler";
import { injectIntoSetupAsync } from "../src/vite/compiler/inject-setup";
import MagicString from "magic-string";

describe("Vite plugin code generation", () => {
  /**
   * Simulates what the Vite plugin does to generate the final module.
   * The key optimization is that we inline the serialized VServerComponent
   * expression directly - no extra function wrapper or object allocation.
   */
  function simulatePluginTransform(sfcSource: string) {
    const { descriptor } = parse(sfcSource, { filename: "test.vue" });

    // Compile script with inlineTemplate (Vue's default)
    let scriptResult = null;
    let scriptBindings: Record<string, any> = {};

    if (descriptor.script || descriptor.scriptSetup) {
      scriptResult = compileScript(descriptor, {
        id: "test-scope",
        inlineTemplate: true,
      });
      scriptBindings = scriptResult.bindings || {};
    }

    // Compile template with onigiri - get inline expression, not a function
    let onigiriExpression = "null";
    if (descriptor.template) {
      const onigiriResult = compileOnigiriInline(descriptor.template.content, {
        bindingMetadata: scriptBindings,
      });
      onigiriExpression = onigiriResult.expression;
    }

    // Simulate the injection (simplified version of what the plugin does)
    if (scriptResult) {
      const s = new MagicString(scriptResult.content);

      // Find setup function
      const setupMatch = scriptResult.content.match(
        /setup\s*\(\s*([^,)]*?)(?:,\s*\{[^}]*\})?\s*\)\s*\{/,
      );

      if (setupMatch && setupMatch.index !== undefined) {
        const setupBodyStart = setupMatch.index + setupMatch[0].length;

        // Inline the expression directly - no function call overhead!
        const injectionCode = `
  // Onigiri: Return serialized VNode directly
  if (__inject(__ONIGIRI_SYMBOL, null)) {
    return () => ${onigiriExpression};
  }
`;
        s.prependLeft(setupBodyStart, injectionCode);
      }

      // Add imports
      s.prepend(`
import { inject as __inject } from "vue";
import { ONIGIRI_RENDER_SYMBOL as __ONIGIRI_SYMBOL } from "vue-onigiri/runtime/shared";
`);

      return s.toString();
    }

    return null;
  }

  it("should inject onigiri check into setup", () => {
    const source = `
<script setup>
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <div>{{ count }}</div>
</template>
`;

    const result = simulatePluginTransform(source);
    expect(result).not.toBeNull();

    // Should have the imports
    expect(result).toContain("import { inject as __inject }");
    expect(result).toContain("ONIGIRI_RENDER_SYMBOL");

    // Should have the inline onigiri check - no function call, just the expression
    expect(result).toContain("if (__inject(__ONIGIRI_SYMBOL");
    expect(result).toContain("return () => [0,"); // Inline element expression

    // Should NOT have a separate renderOnigiri function (it's inlined!)
    expect(result).not.toContain("function __renderOnigiri");
  });

  it("should inline bindings directly in the expression", () => {
    const source = `
<script setup>
import { ref, computed } from 'vue'
const message = ref('hello')
const count = ref(0)
const doubled = computed(() => count.value * 2)
</script>

<template>
  <div>{{ message }} {{ count }} {{ doubled }}</div>
</template>
`;

    const result = simulatePluginTransform(source);
    expect(result).not.toBeNull();

    // The onigiri ABI routes binding access through `_ctx.*` — namespace
    // prefixes ($setup./$props./$data./$options.) from Vue's transformer
    // are stripped so the instance proxy resolves across namespaces and
    // auto-unwraps setup refs.
    expect(result).toContain("_ctx.message");
    expect(result).toContain("_ctx.count");
    expect(result).toContain("_ctx.doubled");
  });

  it("should handle components with props", () => {
    const source = `
<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <h1>{{ title }}</h1>
</template>
`;

    const result = simulatePluginTransform(source);
    expect(result).not.toBeNull();

    expect(result).toContain("_ctx.title");
  });

  it("should handle components without script", () => {
    const source = `
<template>
  <div>Static content</div>
</template>
`;

    // This should not crash
    const result = simulatePluginTransform(source);
    // No script = null result (component needs script for setup injection)
    expect(result).toBeNull();
  });

  it("should generate correct VServerComponent types in renderOnigiri", () => {
    const source = `
<script setup>
const msg = 'hello'
</script>

<template>
  <div class="container">
    <span>{{ msg }}</span>
  </div>
</template>
`;

    const result = simulatePluginTransform(source);
    expect(result).not.toBeNull();

    // Should contain element type (0) for div and span
    expect(result).toContain("[0, \"div\"");
    expect(result).toContain("[0, \"span\"");
    // Should contain text type (2) for the interpolation
    expect(result).toContain("[2,");
  });
});

describe("injectIntoSetupAsync setup bridge", () => {
  const fixturePath = path.resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "fixtures/components/LiteralConst.vue",
  );
  const fakeConfig = {
    root: fileURLToPath(new URL("..", import.meta.url)),
    isProduction: false,
  } as ResolvedConfig;

  it("bridges literal-const setup bindings into _ctx", async () => {
    const source = readFileSync(fixturePath, "utf8");
    const { descriptor } = parse(source, { filename: fixturePath });
    const compiled = compileScript(descriptor, { id: fixturePath, inlineTemplate: true });

    const result = await injectIntoSetupAsync(compiled.content, fixturePath, false, fakeConfig);

    expect(result).not.toBeNull();
    // `const TITLE = "..."` / `const count = 1` are `literal-const`
    // bindings. They must land in the closure bridge, otherwise the
    // proxy falls through to the (empty) inline-render setupState and
    // the template renders `undefined`.
    expect(result!.code).toContain("get TITLE() { return TITLE }");
    expect(result!.code).toContain("get count() { return count }");

    // The injected early-return must sit BEFORE the inline render
    // arrow (`return (_ctx, ...) => {`) so it is reachable, and after
    // the bindings so the bridge getters never hit the TDZ.
    const injectedAt = result!.code.indexOf("if (__onigiri_inject(__ONIGIRI_SYMBOL");
    const inlineRenderAt = result!.code.indexOf("return (_ctx");
    const lastBindingAt = result!.code.lastIndexOf("const TITLE = \"Hello from literal\"");
    expect(injectedAt).toBeGreaterThan(-1);
    expect(inlineRenderAt).toBeGreaterThan(-1);
    expect(injectedAt).toBeLessThan(inlineRenderAt);
    expect(injectedAt).toBeGreaterThan(lastBindingAt);
  });
});
