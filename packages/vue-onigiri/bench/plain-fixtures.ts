import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

const PLAIN_RE = /\.plain\.vue$/;
const DIRECTIVE_RE = / v-load-client(?:="[^"]*")?/g;

/**
 * Serve `X.plain.vue` as `X.vue` without its `v-load-client` directives, so the
 * plain Vue baseline compiles through the same plugin-vue, minus the islands.
 */
export function plainFixturePlugin(): Plugin {
  return {
    name: "bench:plain-fixtures",
    enforce: "pre",
    resolveId(id, importer) {
      if (!PLAIN_RE.test(id)) return null;
      return importer ? resolve(dirname(importer), id) : id;
    },
    load(id) {
      if (!PLAIN_RE.test(id)) return null;
      return readFileSync(id.replace(PLAIN_RE, ".vue"), "utf8").replace(DIRECTIVE_RE, "");
    },
  };
}
