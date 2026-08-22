import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, compileScript } from "@vue/compiler-sfc";
import { format } from "oxfmt";
import { compileOnigiri } from "../src/template-compiler";
import { buildImportMap } from "../src/vite/compiler/imports";

const FIXTURES_DIR = fileURLToPath(new URL("compiler-fixtures", import.meta.url));

const FIXTURE_NAMES = readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

describe("compiler fixture snapshots", () => {
  for (const name of FIXTURE_NAMES) {
    it(name, async () => {
      const filePath = join(FIXTURES_DIR, name, "input.vue");
      // Windows checkouts may carry CRLF; snapshots must not depend on it.
      const source = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");

      const { descriptor, errors } = parse(source, { filename: `${name}/input.vue` });
      expect(errors).toEqual([]);

      const scriptResult =
        descriptor.scriptSetup || descriptor.script
          ? compileScript(descriptor, { id: `${name}/input.vue` })
          : undefined;

      const importMap = await buildImportMap(scriptResult?.imports, filePath, FIXTURES_DIR);

      if (!descriptor.template) {
        throw new Error(`fixture "${name}" has no <template> block`);
      }

      const result = compileOnigiri(descriptor.template.content, {
        bindingMetadata: scriptResult?.bindings ?? {},
        importMap,
      });

      const formatted = await format("compiler.snapshot.js", result.code);
      expect(formatted.errors).toEqual([]);

      await expect(formatted.code).toMatchFileSnapshot(
        join(FIXTURES_DIR, name, "compiler.snapshot"),
      );
    });
  }
});
