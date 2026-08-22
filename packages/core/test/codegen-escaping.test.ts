import { describe, expect, it } from "vitest";
import { parse, compileScript } from "@vue/compiler-sfc";
import { compileOnigiri } from "../src/template-compiler";
import { genScriptImports } from "../src/vite/compiler/imports";

/**
 * Template-derived strings reach codegen as raw text. Quoting them by hand lets a
 * value containing `"` close the emitted literal and run as code, so every site
 * that emits one goes through JSON.stringify.
 */
describe("codegen escapes template-derived strings", () => {
  it("a slot name cannot close the emitted literal", () => {
    // Attribute values are entity-decoded, so `&quot;` arrives as a real quote.
    const { code } = compileOnigiri(
      `<div><slot name="a&quot;+(globalThis.PWNED=1)+&quot;b" /></div>`,
    );
    expect(code).toContain(String.raw`"a\"+(globalThis.PWNED=1)+\"b"`);
    expect(code).not.toContain('(globalThis.PWNED=1)+"b",');
  });

  it("a component tag cannot close the emitted literal", () => {
    const { code } = compileOnigiri(`<Foo"+(globalThis.PWNED=1)+"a />`);
    expect(code).toContain(String.raw`"Foo\"+(globalThis.PWNED=1)+\"a"`);
  });

  it("an element tag cannot close the emitted literal", () => {
    const { code } = compileOnigiri(`<span"+(globalThis.PWNED=1)+"a />`);
    expect(code).toContain(String.raw`"span\"+(globalThis.PWNED=1)+\"a"`);
  });

  it("leaves ordinary tags and slot names byte-identical", () => {
    const { code } = compileOnigiri(`<div><slot name="header" /><Foo /></div>`);
    expect(code).toContain(`"div"`);
    expect(code).toContain(`"header"`);
    expect(code).toContain(`__onigiri_resolveComponent(__instance, "Foo")`);
  });
});

/**
 * The virtual render module is a separate file from the SFC, so every binding the
 * template references has to be imported into it again. These are the shapes the
 * previous line-anchored regex dropped, leaving the render with a dead identifier.
 */
describe("script imports survive real-world formatting", () => {
  const importsOf = (script: string): string => {
    const { descriptor } = parse(
      `<script setup lang="ts">\n${script}\n</script>\n<template><div /></template>`,
      { filename: "test.vue" },
    );
    return genScriptImports(compileScript(descriptor, { id: "test" }).imports);
  };

  it("keeps a multi-line named import", () => {
    expect(importsOf(`import {\n  Bar,\n  Baz,\n} from './widgets'`)).toBe(
      `import { Bar, Baz } from "./widgets";\n`,
    );
  });

  it("keeps an import with a trailing comment", () => {
    expect(importsOf(`import Qux from './Qux.vue' // still an import`)).toBe(
      `import Qux from "./Qux.vue";\n`,
    );
  });

  it("keeps a namespace import", () => {
    expect(importsOf(`import * as All from './all'`)).toBe(`import * as All from "./all";\n`);
  });

  it("groups bindings from one source and preserves the alias", () => {
    expect(importsOf(`import Foo, { bar as baz } from './Foo.vue'`)).toBe(
      `import { default as Foo, bar as baz } from "./Foo.vue";\n`,
    );
  });

  it("drops type-only imports", () => {
    expect(importsOf(`import type { Props } from './types'\nimport Foo from './Foo.vue'`)).toBe(
      `import Foo from "./Foo.vue";\n`,
    );
  });

  it("emits the binding a multi-line import declares, so the render can reference it", () => {
    const source = `
<script setup>
import {
  Bar,
} from './widgets'
</script>
<template><Bar /></template>
`;
    const { descriptor } = parse(source, { filename: "test.vue" });
    const script = compileScript(descriptor, { id: "test" });
    const emitted =
      genScriptImports(script.imports) +
      compileOnigiri(descriptor.template!.content, { bindingMetadata: script.bindings }).code;

    expect(emitted).toContain(`import { Bar } from "./widgets";`);
    // The render references `Bar` directly; without the import it is a ReferenceError.
    expect(emitted).toContain("__serializeComponentInContext(Bar,");
  });
});
