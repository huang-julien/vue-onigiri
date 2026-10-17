import { bench, describe } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScript, parse } from "@vue/compiler-sfc";
import { compileOnigiri, type OnigiriCompilerOptions } from "@vue-onigiri/compiler";
import { buildImportMap } from "../../src/vite/compiler/imports";

const fixturesDir = fileURLToPath(new URL("../../test/compiler-fixtures/", import.meta.url));

/**
 * Every compiler snapshot fixture, prepared like `test/compiler.snapshots.test.ts`
 * (SFC parse, script bindings, import map) once, outside the measured loop.
 */
const fixtures = await Promise.all(
  readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(async ({ name }) => {
      const filePath = join(fixturesDir, name, "input.vue");
      const { descriptor } = parse(readFileSync(filePath, "utf8"), {
        filename: `${name}/input.vue`,
      });
      const scriptResult =
        descriptor.scriptSetup || descriptor.script
          ? compileScript(descriptor, { id: `${name}/input.vue` })
          : undefined;
      const options: OnigiriCompilerOptions = {
        bindingMetadata: scriptResult?.bindings ?? {},
        importMap: await buildImportMap(scriptResult?.imports, filePath, fixturesDir),
      };
      return { template: descriptor.template?.content ?? "", options };
    }),
);

/** A wide template mixing elements, bindings, events, v-if and v-for. */
const largeTemplate = `<div class="root">${Array.from(
  { length: 50 },
  (_, i) => `
  <section :id="'s-${i}'" :class="{ active: current === ${i} }" @click="select(${i})">
    <h2>{{ title }} ${i}</h2>
    <p v-if="items.length > ${i}">{{ items[${i}].label }}</p>
    <p v-else>Empty</p>
    <ul><li v-for="item in items" :key="item.id">{{ item.label }}</li></ul>
    <MyComponent :value="value" @update="onUpdate"><span>slot ${i}</span></MyComponent>
  </section>`,
).join("")}
</div>`;

describe("template compiler", () => {
  bench("compileOnigiri fixtures", () => {
    for (const { template, options } of fixtures) {
      compileOnigiri(template, options);
    }
  });

  bench("compileOnigiri large template", () => {
    compileOnigiri(largeTemplate);
  });
});
