// @vitest-environment happy-dom

import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build, type Plugin, type Rollup } from "vite";

interface ProductionTransport {
  /** Create a Vue client app from the production bundle. */
  createApp: typeof import("vue").createApp;
  /** Wait for Vue's queued DOM updates. */
  nextTick: typeof import("vue").nextTick;
  /** Create a shallow reactive reference from the production bundle. */
  shallowRef: typeof import("vue").shallowRef;
  /** Rebuild a VNode tree from marked HTML. */
  htmlToVNode: typeof import("../src/runtime/dom-to-vnode").htmlToVNode;
}

const DOM_TO_VNODE_PATH = fileURLToPath(
  new NodeURL("../src/runtime/dom-to-vnode.ts", import.meta.url),
);
const VIRTUAL_ENTRY = "virtual:production-transport";
const VIRTUAL_RESOLVED_ENTRY = "\0production-transport";

describe("domToVNode production bundle", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reuses previous htmlToVNode static runs without losing production anchors", async () => {
    const transport = await buildProductionTransport();
    const html1 = "<!--[--><p data-a>same</p><!--split--><p data-b>one</p><!--]-->";
    const html2 = "<!--[--><p data-a>same</p><!--split--><p data-b>two</p><!--]-->";
    const html3 = "<!--[--><p data-a>later</p><!--split--><p data-b>two</p><!--]-->";
    const container = document.createElement("div");
    document.body.append(container);
    const vnodeA = transport.htmlToVNode(html1);
    const currentVNode = transport.shallowRef(vnodeA);

    const app = transport.createApp({
      setup: () => () => currentVNode.value,
    });
    app.mount(container);
    await transport.nextTick();

    const keyedA = container.querySelector("[data-a]");
    const keyedB = container.querySelector("[data-b]");
    expect(container.textContent).toBe("sameone");
    expect(keyedA).not.toBeNull();
    expect(keyedB).not.toBeNull();

    const vnodeB = transport.htmlToVNode(html2, { previous: vnodeA });
    currentVNode.value = vnodeB;
    await transport.nextTick();

    const stillKeyedA = container.querySelector("[data-a]");
    const changedB = container.querySelector("[data-b]");
    expect(container.textContent).toBe("sametwo");
    expect(stillKeyedA).toBe(keyedA);
    expect(changedB).not.toBe(keyedB);

    const vnodeC = transport.htmlToVNode(html3, { previous: vnodeB });
    currentVNode.value = vnodeC;
    await transport.nextTick();

    expect(container.textContent).toBe("latertwo");
    expect(container.querySelector("[data-a]")).not.toBe(stillKeyedA);
    expect(container.querySelector("[data-b]")).toBe(changedB);

    app.unmount();
    expect(container.innerHTML).toBe("");
  });
});

async function buildProductionTransport(): Promise<ProductionTransport> {
  const result = (await build({
    configFile: false,
    mode: "production",
    define: { "process.env.NODE_ENV": JSON.stringify("production"), __DEV__: "false" },
    logLevel: "silent",
    plugins: [virtualTransportPlugin()],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        external: [],
        input: VIRTUAL_ENTRY,
        output: {
          format: "iife",
          name: "ProductionTransport",
          inlineDynamicImports: true,
        },
      },
    },
  })) as Rollup.RollupOutput;
  const output = result.output;
  const chunk = output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing production transport chunk");
  expect(chunk.code.includes("patchStaticNode")).toBe(false);
  const transport = new Function(
    `${chunk.code};const result = globalThis.ProductionTransport;delete globalThis.ProductionTransport;return result;`,
  )() as ProductionTransport;
  return transport;
}

function virtualTransportPlugin(): Plugin {
  return {
    name: "production-transport-entry",
    enforce: "pre",
    resolveId(id) {
      if (id === VIRTUAL_ENTRY) return VIRTUAL_RESOLVED_ENTRY;
    },
    load(id) {
      if (id !== VIRTUAL_RESOLVED_ENTRY) return;
      return `
        import { createApp, nextTick, shallowRef } from "vue";
        import { htmlToVNode } from ${JSON.stringify(DOM_TO_VNODE_PATH)};

        globalThis.ProductionTransport = {
          createApp,
          nextTick,
          shallowRef,
          htmlToVNode,
        };
      `;
    },
  };
}
