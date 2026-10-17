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
import { renderOnigiri } from "../../src/runtime/deserialize";
import { domToVNode, htmlToVNode } from "../../src/runtime/dom-to-vnode";
import type { OnigiriPayload } from "@vue-onigiri/shared";
import { withLoadClient, type GeneratedIslandCase } from "../shared";
import case1000 from "./generated/island-1000.json";
import case10000 from "./generated/island-10000.json";

const CASES = [case1000 as GeneratedIslandCase, case10000 as GeneratedIslandCase];

const BENCH_OPTIONS = { warmupIterations: 10, iterations: 50, time: 2000 };

const OPTIONS = { importFn: async () => Counter as DefineComponent };

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
function assertAdopted(label: string, html: string, nonce: string | undefined, rows: number) {
  const el = hydrateContainer(html);
  const before = [...el.querySelectorAll("li")];
  const app = createSSRApp({ render: () => domToVNode(el.firstChild!, { ...OPTIONS, nonce }) });
  app.mount(el);
  return new Promise<void>((resolve, reject) => {
    // The loader resolves its import in a microtask; buttons exist once Suspense settles.
    setTimeout(() => {
      try {
        const after = [...el.querySelectorAll("li")];
        if (before.length !== rows || after.length !== rows) {
          throw new Error(`${label}: expected ${rows} rows, got ${before.length}/${after.length}`);
        }
        for (let i = 0; i < rows; i++) {
          if (before[i] !== after[i]) throw new Error(`${label}: row ${i} was replaced`);
        }
        const buttons = [...el.querySelectorAll("button")];
        for (const button of buttons) button.click();
        app.unmount();
        el.remove();
        resolve();
      } catch (error) {
        reject(error);
      }
    }, 50);
  });
}

for (const data of CASES) {
  await assertAdopted("onigiri-dom", data.onigiriMarkedHtml, undefined, data.rows);
  await assertAdopted("onigiri-dom html-first", data.htmlFirstHtml, data.htmlFirstNonce, data.rows);
}

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
      "onigiri",
      () => {
        const el = hydrateContainer(data.onigiriMarkedHtml);
        const app = createSSRApp({
          render: () => renderOnigiri(data.payload as OnigiriPayload, OPTIONS),
        });
        app.mount(el);
        app.unmount();
        el.remove();
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri-dom",
      () => {
        const el = hydrateContainer(data.onigiriMarkedHtml);
        const app = createSSRApp({ render: () => domToVNode(el.firstChild!, OPTIONS) });
        app.mount(el);
        app.unmount();
        el.remove();
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri-dom html-first",
      () => {
        const el = hydrateContainer(data.htmlFirstHtml);
        const app = createSSRApp({
          render: () => domToVNode(el.firstChild!, { ...OPTIONS, nonce: data.htmlFirstNonce }),
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
      "onigiri renderOnigiri",
      async () => {
        flip = !flip;
        current.value = renderOnigiri(
          (flip ? data.nextPayload : data.payload) as OnigiriPayload,
          OPTIONS,
        );
        await nextTick();
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri htmlToVNode",
      async () => {
        flip = !flip;
        current.value = htmlToVNode(flip ? data.nextMarkedHtml : data.onigiriMarkedHtml, {
          ...OPTIONS,
          previous: current.value,
        });
        await nextTick();
      },
      BENCH_OPTIONS,
    );

    bench(
      "onigiri htmlToVNode html-first",
      async () => {
        flip = !flip;
        current.value = htmlToVNode(flip ? data.nextHtmlFirstHtml : data.htmlFirstHtml, {
          ...OPTIONS,
          nonce: flip ? data.nextHtmlFirstNonce : data.htmlFirstNonce,
          previous: current.value,
        });
        await nextTick();
      },
      BENCH_OPTIONS,
    );
  });
}
