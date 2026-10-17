import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { onigiriSourceCapturePlugin } from "../src/vite/compiler/source-capture";
import { ssrLoadClientTransform } from "../src/vite/compiler/ssr-load-client";

const HTML_FIRST_RE = /\.html-first\.vue$/;

/**
 * Serve `X.html-first.vue` from `X.vue`, compiled by a plugin-vue instance that
 * carries the SSR marker transform, so one fixture renders through both paths.
 * Put `vue({ exclude: HTML_FIRST_RE })` after these plugins.
 */
export function htmlFirstFixturePlugins(): Plugin[] {
  return [
    {
      name: "bench:html-first-fixtures",
      enforce: "pre",
      resolveId(id, importer) {
        if (!HTML_FIRST_RE.test(id)) return null;
        return importer ? resolve(dirname(importer), id) : id;
      },
      load(id) {
        if (!HTML_FIRST_RE.test(id)) return null;
        return readFileSync(id.replace(HTML_FIRST_RE, ".vue"), "utf8");
      },
    },
    // The onigiri compiler reads captured sources, so the virtual path never hits the disk.
    onigiriSourceCapturePlugin(),
    vue({
      include: HTML_FIRST_RE,
      template: { compilerOptions: { nodeTransforms: [ssrLoadClientTransform] } },
    }),
  ];
}

export { HTML_FIRST_RE };
