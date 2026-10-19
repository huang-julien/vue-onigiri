import { bench, describe } from "vitest";
import { createApp, createSSRApp } from "vue";
import Tree from "../fixtures/Tree.vue";
import { domToVNode, htmlToVNode } from "../../src/runtime/dom-to-vnode";
import { CLIENT_ROW_COUNTS, RENDER_MODES, type GeneratedCase, type RenderMode } from "../shared";
import case1000 from "./generated/1000.json";
import case10000 from "./generated/10000.json";

const CASES: Record<number, GeneratedCase> = {
  1000: case1000 as GeneratedCase,
  10000: case10000 as GeneratedCase,
};

const BENCH_OPTIONS = { warmupIterations: 10, iterations: 50, time: 2000 };

/** `Tree.vue` carries no markers, so any nonce reads its HTML as one static run. */
const NONCE = "benchnonce000000";

// Hydrate timings include setting innerHTML, equally for both sides.
function container(mode: RenderMode, html: string): HTMLElement {
  const el = document.createElement("div");
  if (mode === "hydrate") el.innerHTML = html;
  document.body.append(el);
  return el;
}

for (const mode of RENDER_MODES) {
  for (const rows of CLIENT_ROW_COUNTS) {
    const data = CASES[rows]!;
    const create = mode === "hydrate" ? createSSRApp : createApp;

    describe(`client ${mode} rows=${rows}`, () => {
      bench(
        "vue",
        () => {
          const el = container(mode, data.vueHtml);
          const app = create(Tree, { count: rows });
          app.mount(el);
          app.unmount();
          el.remove();
        },
        BENCH_OPTIONS,
      );

      // Mount builds the tree from the HTML string, hydrate adopts the DOM in place.
      bench(
        "onigiri-dom",
        () => {
          const el = container(mode, data.vueHtml);
          const app = create({
            render: () =>
              mode === "hydrate"
                ? domToVNode(el.firstChild!, { nonce: NONCE })
                : htmlToVNode(data.vueHtml, { nonce: NONCE }),
          });
          app.mount(el);
          app.unmount();
          el.remove();
        },
        BENCH_OPTIONS,
      );
    });
  }
}
