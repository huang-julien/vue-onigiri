import { describe, it, expect } from "vite-plus/test";
import { parse, compileScript } from "@vue/compiler-sfc";
import { compileOnigiri, compileOnigiriInline } from "../src/template-compiler";

describe("onigiri compiler", () => {
  describe("compileOnigiri", () => {
    it("should generate renderOnigiri function with _ctx parameter", () => {
      const template = `<div class="test">{{ message }}</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("function renderOnigiri(_ctx, __instance)");
      expect(result.code).toContain("return [");
    });

    it("should access bindings via _ctx", () => {
      const template = `<div>{{ msg }}</div>`;
      const result = compileOnigiri(template);

      // The interpolation should reference _ctx.msg or just msg
      expect(result.code).toContain("msg");
    });
  });

  describe("compileOnigiriInline", () => {
    it("should generate an inline expression without function wrapper", () => {
      const template = `<div class="test">{{ message }}</div>`;
      const result = compileOnigiriInline(template);

      // Should NOT contain function wrapper
      expect(result.expression).not.toContain("function");
      expect(result.expression).not.toContain("return");

      // Should be a direct array expression
      expect(result.expression).toMatch(/^\[0,/); // Starts with element type
      expect(result.expression).toContain('"div"');
      expect(result.expression).toContain("message");
    });

    it("should handle multiple root elements as fragment expression", () => {
      const template = `<div>A</div><span>B</span>`;
      const result = compileOnigiriInline(template);

      // Fragment type is 3
      expect(result.expression).toMatch(/^\[3,/);
      expect(result.expression).toContain('"div"');
      expect(result.expression).toContain('"span"');
    });

    it("should return null for empty template", () => {
      const result = compileOnigiriInline("");
      expect(result.expression).toBe("null");
    });
  });

  describe("script + template integration", () => {
    it("should compile a full SFC and generate onigiri output", () => {
      const source = `
<script setup>
import { ref } from 'vue'

const count = ref(0)
const message = 'Hello'
</script>

<template>
  <div class="container">
    <span>{{ message }}</span>
    <button>{{ count }}</button>
  </div>
</template>
`;

      // Parse the SFC
      const { descriptor } = parse(source, { filename: "test.vue" });

      // Compile script to get bindings
      const scriptResult = compileScript(descriptor, {
        id: "test",
        inlineTemplate: true,
      });

      expect(scriptResult.bindings).toBeDefined();
      expect(scriptResult.bindings).toHaveProperty("count");
      expect(scriptResult.bindings).toHaveProperty("message");

      // Compile template with onigiri
      const onigiriResult = compileOnigiri(descriptor.template!.content, {
        bindingMetadata: scriptResult.bindings,
      });

      expect(onigiriResult.code).toContain("renderOnigiri");
      expect(onigiriResult.code).toContain('"div"'); // Element tag
      expect(onigiriResult.code).toContain('"span"');
      expect(onigiriResult.code).toContain('"button"');
    });

    it("should handle props correctly", () => {
      const source = `
<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <h1>{{ title }}</h1>
</template>
`;

      const { descriptor } = parse(source, { filename: "test.vue" });

      const scriptResult = compileScript(descriptor, {
        id: "test",
        inlineTemplate: true,
      });

      expect(scriptResult.bindings).toHaveProperty("title");

      const onigiriResult = compileOnigiri(descriptor.template!.content, {
        bindingMetadata: scriptResult.bindings,
      });

      expect(onigiriResult.code).toContain("renderOnigiri");
      expect(onigiriResult.code).toContain('"h1"');
    });

    it("should handle v-if directives", () => {
      const template = `<div v-if="show">Visible</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      // Note: Current implementation doesn't fully handle v-if yet
      // Just verify it doesn't crash and produces output
      expect(result.code).toContain("show");
    });

    it("should handle v-for directives", () => {
      const template = `<div v-for="item in items" :key="item.id">{{ item.name }}</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      // Note: Current implementation doesn't fully handle v-for yet
      // Just verify it produces output with the iteration variables
      expect(result.code).toContain("item");
    });

    it("should handle dynamic attributes", () => {
      const template = `<div :class="dynamicClass" :id="elementId">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      expect(result.code).toContain("dynamicClass");
      expect(result.code).toContain("elementId");
    });

    it("should handle nested elements", () => {
      const template = `
        <div class="outer">
          <div class="inner">
            <span>Nested content</span>
          </div>
        </div>
      `;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      expect(result.code).toContain('"div"');
      expect(result.code).toContain('"span"');
      expect(result.code).toContain('"outer"');
      expect(result.code).toContain('"inner"');
    });

    it("should handle components with v-load-client", () => {
      const template = `<MyComponent v-load-client :prop="value" />`;
      const result = compileOnigiri(template, {
        additionalImports: new Map([["MyComponent", { path: "/components/MyComponent.vue" }]]),
      });

      expect(result.code).toContain("renderOnigiri");
      expect(result.code).toContain('"/components/MyComponent.vue"');
      // Component type is 1 (VServerComponentType.Component)
      expect(result.code).toContain("[1,");
    });

    it("v-load-client with a named-export additionalImports entry emits that export", () => {
      // Regression: the codegen used to hardcode `"default"` for the chunk
      // export name regardless of what `additionalImports[tag].export` said,
      // so a host registering a named export (e.g. Nuxt's
      // `addComponent({ export: 'ComarkRenderer', filePath: '@comark/vue' })`)
      // would resolve to `mod.default` (== undefined) at hydration time and
      // render as an empty comment placeholder.
      const result = compileOnigiri(`<ComarkRenderer v-load-client :tree="tree" />`, {
        additionalImports: new Map([
          ["ComarkRenderer", { path: "@comark/vue", export: "ComarkRenderer" }],
        ]),
      });

      expect(result.code).toContain('"@comark/vue", "ComarkRenderer"');
      expect(result.code).not.toContain('"@comark/vue", "default"');
    });

    it("v-load-client resolves the export through any casing of the tag", () => {
      // Vue normalises template tag names; the additionalImports key may
      // have been registered as any of PascalCase / kebab-case / camelCase.
      // The resolver walks all four casings (raw, Pascal, camel, kebab) so
      // none of those registrations should fall back to `"default"`.
      const compileWith = (tag: string, registryKey: string) =>
        compileOnigiri(`<${tag} v-load-client />`, {
          additionalImports: new Map([
            [registryKey, { path: "@scope/pkg", export: "NamedExport" }],
          ]),
        });

      for (const [tag, key] of [
        ["NamedExport", "NamedExport"],
        ["named-export", "NamedExport"],
        ["NamedExport", "named-export"],
      ] as const) {
        const result = compileWith(tag, key);
        expect(result.code).toContain('"@scope/pkg", "NamedExport"');
      }
    });

    it("v-load-client with a dynamic expression honours additionalImports[tag].export", () => {
      // Same regression as the static path, but for the `v-load-client="expr"`
      // shape that emits `__serializeChildComponent(..., chunkPath, exportName)`.
      const result = compileOnigiri(`<ComarkRenderer v-load-client="visible" :tree="tree" />`, {
        additionalImports: new Map([
          ["ComarkRenderer", { path: "@comark/vue", export: "ComarkRenderer" }],
        ]),
      });

      expect(result.code).toContain('"@comark/vue", "ComarkRenderer"');
      expect(result.code).not.toContain('"@comark/vue", "default"');
    });

    it("should handle components without v-load-client (server-rendered)", () => {
      const template = `<MyComponent :prop="value" />`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      expect(result.code).toContain("__serializeComponentInContext(");
      expect(result.code).toContain("MyComponent");
      // Should NOT contain Component type array - it's server-rendered
      expect(result.code).not.toContain("[1,");
    });

    it("should handle multiple root elements as fragment", () => {
      const template = `
        <div>First</div>
        <div>Second</div>
      `;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      // Fragment type is 3 (VServerComponentType.Fragment)
      expect(result.code).toContain("[3,");
    });
  });

  describe("generated code structure", () => {
    it("should generate valid JavaScript (ES module)", () => {
      const template = `<div class="test">{{ message }}</div>`;
      const result = compileOnigiri(template);

      // The output is an ES module with export, which can't be tested with new Function()
      // Instead verify the structure is correct
      expect(result.code).toContain("export function renderOnigiri");
      expect(result.code).toContain("return [");
      // Should not have obvious syntax errors
      expect(result.code).not.toContain("undefined undefined");
    });

    it("should export the renderOnigiri function", () => {
      const template = `<div>Test</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("export function renderOnigiri");
    });

    it("should return VServerComponent array structure", () => {
      const template = `<div class="test">Hello</div>`;
      const result = compileOnigiri(template);

      // Should return array starting with type (0 = Element)
      expect(result.code).toMatch(/return \[0,/);
    });
  });

  describe("slots", () => {
    it("should handle default slot content", () => {
      const template = `<MyComponent>Default slot content</MyComponent>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("MyComponent");
      expect(result.code).toContain("default");
    });

    it("should handle named slots", () => {
      const template = `
        <MyComponent>
          <template #header>Header content</template>
          <template #footer>Footer content</template>
        </MyComponent>
      `;
      const result = compileOnigiri(template);

      expect(result.code).toContain("MyComponent");
      // Named slots should be present
      expect(result.code).toContain("header");
      expect(result.code).toContain("footer");
    });

    it("should handle slot with fallback content", () => {
      const template = `<slot>Fallback content</slot>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("slot");
      expect(result.code).toContain("Fallback content");
    });
  });

  describe("event handlers", () => {
    it("should handle v-on event handlers", () => {
      const template = `<button @click="handleClick">Click me</button>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"button"');
      // Events should be captured in props (camelCase per Vue convention)
      expect(result.code).toContain("onClick");
      expect(result.code).toContain("handleClick");
    });

    it("should handle v-on with modifiers", () => {
      const template = `<form @submit.prevent="onSubmit">Submit</form>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"form"');
      expect(result.code).toContain("onSubmit");
    });

    it("should handle inline handlers", () => {
      const template = `<button @click="count++">Increment</button>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("count++");
    });
  });

  describe("static content optimization", () => {
    it("should handle purely static content", () => {
      const template = `<div class="static">Static text</div>`;
      const result = compileOnigiri(template);

      // Static content should be preserved as-is
      expect(result.code).toContain('"div"');
      expect(result.code).toContain('"static"');
      expect(result.code).toContain("Static text");
    });

    it("should handle mixed static and dynamic content", () => {
      const template = `<div class="static" :id="dynamicId">Hello {{ name }}</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"static"');
      expect(result.code).toContain("dynamicId");
      expect(result.code).toContain("name");
    });

    it("should handle boolean attributes", () => {
      const template = `<input disabled readonly />`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"input"');
      expect(result.code).toContain("disabled");
      expect(result.code).toContain("readonly");
    });
  });

  describe("class and style bindings", () => {
    it("should handle static class", () => {
      const template = `<div class="foo bar">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"foo bar"');
    });

    it("should handle dynamic class binding", () => {
      const template = `<div :class="{ active: isActive }">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("active");
      expect(result.code).toContain("isActive");
    });

    it("should handle array class binding", () => {
      const template = `<div :class="[baseClass, activeClass]">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("baseClass");
      expect(result.code).toContain("activeClass");
    });

    it("should handle inline style object", () => {
      const template = `<div :style="{ color: textColor }">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("color");
      expect(result.code).toContain("textColor");
    });

    it("should handle static style", () => {
      const template = `<div style="color: red; font-size: 14px">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("color: red");
    });
  });

  describe("special elements", () => {
    it("should handle template element", () => {
      const template = `<template v-if="show"><div>Conditional</div></template>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("show");
      expect(result.code).toContain('"div"');
    });

    it("should handle self-closing elements", () => {
      const template = `<img src="test.png" /><br /><hr />`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"img"');
      expect(result.code).toContain('"br"');
      expect(result.code).toContain('"hr"');
    });

    it("should handle HTML comments (skip them)", () => {
      const template = `<div><!-- This is a comment -->Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"div"');
      expect(result.code).toContain("Content");
      // Comments should not appear in output
      expect(result.code).not.toContain("This is a comment");
    });
  });

  describe("text interpolation", () => {
    it("should handle simple interpolation", () => {
      const template = `<span>{{ message }}</span>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("message");
      // Text type is 2
      expect(result.code).toContain("[2,");
    });

    it("should handle multiple interpolations", () => {
      const template = `<span>{{ first }} and {{ second }}</span>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("first");
      expect(result.code).toContain("second");
    });

    it("should handle expressions in interpolation", () => {
      const template = `<span>{{ count + 1 }}</span>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("count + 1");
    });

    it("should handle method calls in interpolation", () => {
      const template = `<span>{{ formatDate(date) }}</span>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("_ctx.formatDate(_ctx.date)");
    });

    it("should handle ternary expressions", () => {
      const template = `<span>{{ isActive ? 'Yes' : 'No' }}</span>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("isActive");
    });
  });

  describe("v-bind variations", () => {
    it("should handle shorthand v-bind", () => {
      const template = `<div :id="elementId" :title="tooltip">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("elementId");
      expect(result.code).toContain("tooltip");
    });

    it("should handle v-bind object spread", () => {
      const template = `<div v-bind="attrs">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("attrs");
    });

    it("should handle dynamic attribute names", () => {
      const template = `<div :[attrName]="attrValue">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("attrName");
      expect(result.code).toContain("attrValue");
    });
  });

  describe("edge cases", () => {
    it("should handle empty elements", () => {
      const template = `<div></div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"div"');
    });

    it("should handle whitespace-only content", () => {
      const template = `<div>   </div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"div"');
    });

    it("should handle deeply nested structures", () => {
      const template = `
        <div>
          <section>
            <article>
              <header>
                <h1>{{ title }}</h1>
              </header>
            </article>
          </section>
        </div>
      `;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"div"');
      expect(result.code).toContain('"section"');
      expect(result.code).toContain('"article"');
      expect(result.code).toContain('"header"');
      expect(result.code).toContain('"h1"');
      expect(result.code).toContain("title");
    });

    it("should handle special characters in text", () => {
      const template = `<div>Hello &amp; goodbye &lt;world&gt;</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"div"');
    });

    it("should handle numeric literals", () => {
      const template = `<div :count="42" :ratio="3.14">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("42");
      expect(result.code).toContain("3.14");
    });
  });

  describe("typescript syntax stripping", () => {
    it("strips `as Type` casts", () => {
      const result = compileOnigiri(`<div :id="(value as string)">Test</div>`);
      expect(result.code).not.toMatch(/\bas\s+string\b/);
      expect(result.code).toContain("_ctx.value");
    });

    it("strips `as` casts in compound member access", () => {
      const result = compileOnigiri(`<div :name="route.meta._layout as string">Test</div>`);
      expect(result.code).not.toMatch(/\bas\s+string\b/);
      expect(result.code).toContain("_ctx.route.meta._layout");
    });

    it("strips `satisfies` casts", () => {
      const result = compileOnigiri(`<div :id="(value satisfies string)">Test</div>`);
      expect(result.code).not.toMatch(/\bsatisfies\b/);
    });

    it("strips non-null `!` assertions", () => {
      const result = compileOnigiri(`<div :id="value!">Test</div>`);
      expect(result.code).not.toMatch(/_ctx\.value!/);
      expect(result.code).toContain("_ctx.value");
    });

    it("strips angle-bracket type assertions", () => {
      const result = compileOnigiri(`<div :id="(<string>value)">Test</div>`);
      expect(result.code).not.toMatch(/<string>/);
      expect(result.code).toContain("_ctx.value");
    });

    it("strips type annotations on v-on inline arrow params", () => {
      const result = compileOnigiri(`<button @click="(e: MouseEvent) => onClick(e)">x</button>`);
      expect(result.code).not.toMatch(/:\s*MouseEvent/);
      expect(result.code).toContain("_ctx.onClick");
    });
  });

  describe("codegen syntax validity and scoping regressions", () => {
    /** Assert the emitted module body parses as JavaScript. */
    const expectParses = (code: string) => {
      const body = code.replace(/^import[^\n]*$/gm, "").replace(/^export /m, "");
      expect(() => new Function(body)).not.toThrow();
    };

    it("comment-only v-if branch emits valid JS (empty fragment)", () => {
      const result = compileOnigiri(`<template v-if="show"><!-- todo --></template>`);
      expectParses(result.code);
      expect(result.code).toContain("? [3, []] :");
    });

    it("comment-only v-for body emits valid JS (empty fragment)", () => {
      const result = compileOnigiri(
        `<template v-for="i in list" :key="i"><!-- todo --></template>`,
      );
      expectParses(result.code);
      expect(result.code).toContain("=> [3, []]");
    });

    it("comment between element children leaves no sparse-array hole", () => {
      const result = compileOnigiri(`<div><!-- c --><span>a</span></div>`);
      expectParses(result.code);
      expect(result.code).not.toContain("[, ");
      expect(result.code).toContain('[[0, "span", undefined, [[2, "a"]]]]');
    });

    it("comment-only template emits null", () => {
      const result = compileOnigiri(`<!-- nothing to render -->`);
      expectParses(result.code);
      expect(result.code).toContain("return null;");
    });

    it("root comment next to an element leaves no sparse-array hole", () => {
      const result = compileOnigiri(`<!-- c --><div>x</div>`);
      expectParses(result.code);
      expect(result.code).not.toContain("[, ");
    });

    it("destructured v-for bindings stay un-prefixed", () => {
      const result = compileOnigiri(`<li v-for="{ id, name } in items" :key="id">{{ name }}</li>`);
      expectParses(result.code);
      expect(result.code).toContain("_renderList(_ctx.items, ({ id, name }) =>");
      expect(result.code).toContain('{"key": id}');
      expect(result.code).toContain("[2, name]");
      expect(result.code).not.toContain("_ctx.id");
      expect(result.code).not.toContain("_ctx.name");
    });

    it("v-for over non-array sources compiles through renderList", () => {
      const obj = compileOnigiri(`<li v-for="(v, k) in obj" :key="k">{{ v }}</li>`);
      expectParses(obj.code);
      expect(obj.code).toContain('import { renderList as _renderList } from "vue"');
      expect(obj.code).toContain("_renderList(_ctx.obj, (v, k) =>");

      const num = compileOnigiri(`<i v-for="n in count" :key="n">{{ n }}</i>`);
      expectParses(num.code);
      expect(num.code).toContain("_renderList(_ctx.count, (n) =>");

      const range = compileOnigiri(`<i v-for="n in 3" :key="n">{{ n }}</i>`);
      expectParses(range.code);
      expect(range.code).toContain("_renderList(3, (n) =>");
    });

    it("nested v-for shadowing the same binding keeps the outer var local afterwards", () => {
      const result = compileOnigiri(`
        <div v-for="item in items" :key="item.id">
          <span v-for="item in item.children" :key="item">{{ item }}</span>
          <em>{{ item.label }}</em>
        </div>
      `);
      expectParses(result.code);
      expect(result.code).toContain("item.label");
      expect(result.code).not.toContain("_ctx.item.label");
    });

    it("scoped slot destructured params stay un-prefixed in the slot body", () => {
      const result = compileOnigiri(
        `<MyComp><template #default="{ item }">{{ item.name }}</template></MyComp>`,
      );
      expectParses(result.code);
      expect(result.code).toContain("({ item }) => [[2, item.name]]");
      expect(result.code).not.toContain("_ctx.item");
    });

    it("scoped slot plain param stays un-prefixed in the slot body", () => {
      const result = compileOnigiri(
        `<MyComp><template #default="slotProps">{{ slotProps.name }}</template></MyComp>`,
      );
      expectParses(result.code);
      expect(result.code).toContain("(slotProps) => [[2, slotProps.name]]");
      expect(result.code).not.toContain("_ctx.slotProps");
    });

    it("custom directive modifiers serialize by name", () => {
      const result = compileOnigiri(`<div v-focus.lazy.deep>x</div>`);
      expectParses(result.code);
      expect(result.code).toContain('{"lazy": true, "deep": true}');
      expect(result.code).not.toContain("[object Object]");
    });

    it("dynamic attribute names emit a computed key", () => {
      const result = compileOnigiri(`<div :[attrName]="attrValue">x</div>`);
      expectParses(result.code);
      expect(result.code).toContain("{[_ctx.attrName]: _ctx.attrValue}");
    });

    it("dynamic event names emit a computed handler key", () => {
      const result = compileOnigiri(`<div @[eventName]="handler">x</div>`);
      expectParses(result.code);
      expect(result.code).toContain("[_toHandlerKey(_ctx.eventName)]: _ctx.handler");
      expect(result.code).toContain('import { toHandlerKey as _toHandlerKey } from "vue"');
    });
  });

  describe("snapshots", () => {
    describe("basic elements", () => {
      it("simple div with text", () => {
        const result = compileOnigiri(`<div>Hello World</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("div with static class", () => {
        const result = compileOnigiri(`<div class="container">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("div with multiple attributes", () => {
        const result = compileOnigiri(`<div id="app" class="main" data-test="value">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("self-closing elements", () => {
        const result = compileOnigiri(`<input type="text" placeholder="Enter text" />`);
        expect(result.code).toMatchSnapshot();
      });

      it("nested elements", () => {
        const result = compileOnigiri(`
          <div class="outer">
            <div class="inner">
              <span>Nested text</span>
            </div>
          </div>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("multiple root elements (fragment)", () => {
        const result = compileOnigiri(`<div>First</div><span>Second</span><p>Third</p>`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("interpolation", () => {
      it("simple variable", () => {
        const result = compileOnigiri(`<span>{{ message }}</span>`);
        expect(result.code).toMatchSnapshot();
      });

      it("expression", () => {
        const result = compileOnigiri(`<span>{{ count + 1 }}</span>`);
        expect(result.code).toMatchSnapshot();
      });

      it("method call", () => {
        const result = compileOnigiri(`<span>{{ formatDate(date) }}</span>`);
        expect(result.code).toMatchSnapshot();
      });

      it("ternary", () => {
        const result = compileOnigiri(`<span>{{ active ? 'Yes' : 'No' }}</span>`);
        expect(result.code).toMatchSnapshot();
      });

      it("mixed text and interpolation", () => {
        const result = compileOnigiri(`<p>Hello {{ name }}, you have {{ count }} messages.</p>`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("dynamic bindings", () => {
      it("v-bind shorthand", () => {
        const result = compileOnigiri(`<div :id="elementId" :class="dynamicClass">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("v-bind object spread", () => {
        const result = compileOnigiri(`<div v-bind="attrs">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("dynamic attribute name", () => {
        const result = compileOnigiri(`<div :[attrName]="attrValue">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("class object binding", () => {
        const result = compileOnigiri(
          `<div :class="{ active: isActive, disabled: isDisabled }">Content</div>`,
        );
        expect(result.code).toMatchSnapshot();
      });

      it("class array binding", () => {
        const result = compileOnigiri(`<div :class="[baseClass, conditionalClass]">Content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("style object binding", () => {
        const result = compileOnigiri(
          `<div :style="{ color: textColor, fontSize: size + 'px' }">Content</div>`,
        );
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("event handlers", () => {
      it("simple click handler", () => {
        const result = compileOnigiri(`<button @click="handleClick">Click me</button>`);
        expect(result.code).toMatchSnapshot();
      });

      it("handler with modifier", () => {
        const result = compileOnigiri(`<form @submit.prevent="onSubmit">Submit</form>`);
        expect(result.code).toMatchSnapshot();
      });

      it("inline expression handler", () => {
        const result = compileOnigiri(`<button @click="count++">Increment</button>`);
        expect(result.code).toMatchSnapshot();
      });

      it("multiple event handlers", () => {
        const result = compileOnigiri(`<input @focus="onFocus" @blur="onBlur" @input="onInput" />`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("directives", () => {
      it("v-if", () => {
        const result = compileOnigiri(`<div v-if="show">Conditional</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("v-else-if and v-else", () => {
        const result = compileOnigiri(`
          <div v-if="status === 'loading'">Loading...</div>
          <div v-else-if="status === 'error'">Error!</div>
          <div v-else>Content</div>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("v-for with key", () => {
        const result = compileOnigiri(
          `<li v-for="item in items" :key="item.id">{{ item.name }}</li>`,
        );
        expect(result.code).toMatchSnapshot();
      });

      it("v-for with index", () => {
        const result = compileOnigiri(
          `<li v-for="(item, index) in items" :key="index">{{ index }}: {{ item }}</li>`,
        );
        expect(result.code).toMatchSnapshot();
      });

      it("v-if branch with a single v-for child emits valid JS", () => {
        const result = compileOnigiri(`
          <template v-if="show">
            <li v-for="item in items" :key="item">{{ item }}</li>
          </template>
        `);

        expect(result.code).not.toMatch(/\?\s*\.\.\.\(/);
        expect(result.code).toContain("? [3, [");
      });

      it("nested v-for body containing only v-for emits valid JS", () => {
        const result = compileOnigiri(`
          <template v-for="group in groups" :key="group.id">
            <li v-for="item in group.items" :key="item">{{ item }}</li>
          </template>
        `);

        expect(result.code).not.toMatch(/=>\s*\.\.\.\(/);
        expect(result.code).toContain("=> [3, [");
      });

      it("v-else branch with a single v-for child emits valid JS", () => {
        const result = compileOnigiri(`
          <template v-if="show">
            <div>shown</div>
          </template>
          <template v-else>
            <li v-for="item in items" :key="item">{{ item }}</li>
          </template>
        `);

        expect(result.code).not.toMatch(/:\s*\.\.\.\(/);
        expect(result.code).toContain(": [3, [");
      });

      it("v-show", () => {
        const result = compileOnigiri(`<div v-show="visible">Visible content</div>`);
        expect(result.code).toMatchSnapshot();
      });

      it("v-model on input", () => {
        const result = compileOnigiri(`<input v-model="text" />`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("components", () => {
      const additionalImports = new Map([
        ["MyComponent", { path: "/components/MyComponent.vue" }],
        ["MyList", { path: "/components/MyList.vue" }],
      ]);

      it("component with props", () => {
        const result = compileOnigiri(`<MyComponent v-load-client :title="title" :count="42" />`, {
          additionalImports,
        });
        expect(result.code).toMatchSnapshot();
      });

      it("component with default slot", () => {
        const result = compileOnigiri(
          `<MyComponent v-load-client>Default slot content</MyComponent>`,
          { additionalImports },
        );
        expect(result.code).toMatchSnapshot();
      });

      it("component with named slots", () => {
        const result = compileOnigiri(
          `
          <MyComponent v-load-client>
            <template #header>Header content</template>
            <template #default>Main content</template>
            <template #footer>Footer content</template>
          </MyComponent>
        `,
          { additionalImports },
        );
        expect(result.code).toMatchSnapshot();
      });

      it("scoped slot on client-loaded component throws", () => {
        expect(() =>
          compileOnigiri(
            `
          <MyList v-load-client :items="items">
            <template #item="{ item, index }">
              <span>{{ index }}: {{ item.name }}</span>
            </template>
          </MyList>
        `,
            { additionalImports },
          ),
        ).toThrow(/Scoped slots are not supported on client-loaded components/);
      });

      it("kebab-case component with v-load-client", () => {
        const result = compileOnigiri(
          `<my-component v-load-client :prop="value">Content</my-component>`,
          { additionalImports },
        );
        expect(result.code).toMatchSnapshot();
      });

      it("component WITHOUT v-load-client (server-rendered)", () => {
        const result = compileOnigiri(`<MyComponent :title="title" :count="42" />`);
        expect(result.code).toMatchSnapshot();
      });

      it("component WITHOUT v-load-client with slot", () => {
        const result = compileOnigiri(`<MyComponent>Slot content</MyComponent>`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("slots", () => {
      it("default slot outlet", () => {
        const result = compileOnigiri(`<slot></slot>`);
        expect(result.code).toMatchSnapshot();
      });

      it("named slot outlet", () => {
        const result = compileOnigiri(`<slot name="header"></slot>`);
        expect(result.code).toMatchSnapshot();
      });

      it("slot with fallback", () => {
        const result = compileOnigiri(`<slot>Fallback content</slot>`);
        expect(result.code).toMatchSnapshot();
      });

      it("scoped slot outlet", () => {
        const result = compileOnigiri(`<slot :item="item" :index="index"></slot>`);
        expect(result.code).toMatchSnapshot();
      });
    });

    describe("inline expressions", () => {
      it("simple element", () => {
        const result = compileOnigiriInline(`<div>Hello</div>`);
        expect(result.expression).toMatchSnapshot();
      });

      it("element with interpolation", () => {
        const result = compileOnigiriInline(`<span>{{ message }}</span>`);
        expect(result.expression).toMatchSnapshot();
      });

      it("component with v-load-client", () => {
        const result = compileOnigiriInline(`<Counter v-load-client :initial="5" />`, {
          additionalImports: new Map([["Counter", { path: "/components/Counter.vue" }]]),
        });
        expect(result.expression).toMatchSnapshot();
      });

      it("component without v-load-client (server-rendered)", () => {
        const result = compileOnigiriInline(`<Counter :initial="5" />`);
        expect(result.expression).toMatchSnapshot();
      });

      it("fragment", () => {
        const result = compileOnigiriInline(`<div>A</div><div>B</div>`);
        expect(result.expression).toMatchSnapshot();
      });

      it("complex nested structure", () => {
        const result = compileOnigiriInline(`
          <div class="card">
            <header class="card-header">
              <h2>{{ title }}</h2>
            </header>
            <div class="card-body">
              <p>{{ content }}</p>
            </div>
          </div>
        `);
        expect(result.expression).toMatchSnapshot();
      });
    });

    describe("real-world examples", () => {
      it("todo item", () => {
        const result = compileOnigiri(`
          <li class="todo-item" :class="{ completed: todo.done }">
            <input type="checkbox" :checked="todo.done" @change="toggle(todo.id)" />
            <span>{{ todo.text }}</span>
            <button @click="remove(todo.id)">×</button>
          </li>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("navigation menu", () => {
        const result = compileOnigiri(`
          <nav class="navbar">
            <a href="/" class="logo">MyApp</a>
            <ul class="nav-links">
              <li v-for="link in links" :key="link.path">
                <a :href="link.path" :class="{ active: currentPath === link.path }">
                  {{ link.label }}
                </a>
              </li>
            </ul>
          </nav>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("form with validation", () => {
        const result = compileOnigiri(`
          <form @submit.prevent="onSubmit" class="form">
            <div class="form-group">
              <label for="email">Email</label>
              <input 
                id="email" 
                type="email" 
                v-model="email" 
                :class="{ error: errors.email }"
              />
              <span v-if="errors.email" class="error-message">{{ errors.email }}</span>
            </div>
            <button type="submit" :disabled="isSubmitting">
              {{ isSubmitting ? 'Submitting...' : 'Submit' }}
            </button>
          </form>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("card component", () => {
        const result = compileOnigiri(`
          <article class="card" :class="[variant, { featured: isFeatured }]">
            <img v-if="image" :src="image" :alt="title" class="card-image" />
            <div class="card-content">
              <h3 class="card-title">{{ title }}</h3>
              <p class="card-description">{{ description }}</p>
              <slot name="actions"></slot>
            </div>
          </article>
        `);
        expect(result.code).toMatchSnapshot();
      });

      it("modal dialog", () => {
        const result = compileOnigiri(`
          <div v-if="isOpen" class="modal-overlay" @click.self="close">
            <div class="modal" role="dialog" :aria-labelledby="titleId">
              <header class="modal-header">
                <h2 :id="titleId">{{ title }}</h2>
                <button @click="close" aria-label="Close">×</button>
              </header>
              <div class="modal-body">
                <slot></slot>
              </div>
              <footer class="modal-footer">
                <slot name="footer">
                  <button @click="close">Close</button>
                </slot>
              </footer>
            </div>
          </div>
        `);
        expect(result.code).toMatchSnapshot();
      });
    });
  });
});
