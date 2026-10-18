import { bench, describe } from "vitest";
import {
  createApp,
  createSSRApp,
  createStaticVNode,
  nextTick,
  shallowRef,
  type DefineComponent,
  type VNode,
} from "vue";
import Island from "../fixtures/Island.vue";
import Counter from "../fixtures/Counter.vue";
import { domToVNode, htmlToVNode } from "../../src/runtime/dom-to-vnode";
import { withLoadClient, type GeneratedIslandCase } from "../shared";
import case1000 from "./generated/island-1000.json";
import case10000 from "./generated/island-10000.json";

const CASES = [case1000 as GeneratedIslandCase, case10000 as GeneratedIslandCase];

const BENCH_OPTIONS = { warmupIterations: 10, iterations: 50, time: 2000 };

const IMPORT_FN = async () => Counter as DefineComponent;

function hydrateContainer(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

/**
 * Production Vue hides mismatches, so prove adoption instead: every row element
 * must survive hydration by identity and every counter must be interactive.
 */
function assertAdopted(data: GeneratedIslandCase) {
  const el = hydrateContainer(data.htmlFirstHtml);
  const before = [...el.querySelectorAll("li")];
  const app = createSSRApp({
    render: () => domToVNode(el.firstChild!, { importFn: IMPORT_FN, nonce: data.htmlFirstNonce }),
  });
  app.mount(el);
  return new Promise<void>((resolve, reject) => {
    // The loader resolves its import in a microtask; buttons exist once Suspense settles.
    setTimeout(() => {
      try {
        const after = [...el.querySelectorAll("li")];
        if (before.length !== data.rows || after.length !== data.rows) {
          throw new Error(`expected ${data.rows} rows, got ${before.length}/${after.length}`);
        }
        for (let i = 0; i < data.rows; i++) {
          if (before[i] !== after[i]) throw new Error(`row ${i} was replaced`);
        }
        for (const button of el.querySelectorAll("button")) button.click();
        app.unmount();
        el.remove();
        resolve();
      } catch (error) {
        reject(error);
      }
    }, 50);
  });
}

for (const data of CASES) await assertAdopted(data);

for (const data of CASES) {
  const props = { count: data.rows, every: data.every };

  describe(`island hydrate rows=${data.rows}`, () => {
    bench(
      "vue",
      () => {
        const el = hydrateContainer(data.vueHtml);
        const app = withLoadClient(createSSRApp(Island, props));
        app.mount(el);
        app.unmount();
        el.remove();
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri-dom",
      () => {
        const el = hydrateContainer(data.htmlFirstHtml);
        const app = createSSRApp({
          render: () =>
            domToVNode(el.firstChild!, { importFn: IMPORT_FN, nonce: data.htmlFirstNonce }),
        });
        app.mount(el);
        app.unmount();
        el.remove();
      },
      BENCH_OPTIONS,
    );
  });

  // One mounted app per case; each iteration swaps to the other tree so the patch does real work.
  const current = shallowRef<VNode | undefined>();
  let flip = false;
  const el = document.createElement("div");
  document.body.append(el);
  createApp({ render: () => current.value }).mount(el);

  describe(`island refresh rows=${data.rows}`, () => {
    bench(
      "vue static",
      async () => {
        flip = !flip;
        current.value = createStaticVNode(flip ? data.nextVueHtml : data.vueHtml, 1);
        await nextTick();
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri htmlToVNode",
      async () => {
        flip = !flip;
        current.value = htmlToVNode(flip ? data.nextHtmlFirstHtml : data.htmlFirstHtml, {
          importFn: IMPORT_FN,
          nonce: flip ? data.nextHtmlFirstNonce : data.htmlFirstNonce,
          previous: current.value,
        });
        await nextTick();
      },
      BENCH_OPTIONS,
    );
  });
}
