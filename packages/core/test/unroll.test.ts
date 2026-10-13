import { describe, expect, it, vi } from "vitest";
import { unrollServerComponentBufferPromises } from "../src/runtime/serialize";
import {
  VServerComponentType,
  type BufferedChildren,
  type MaybePromise,
  type VServerComponentBuffered,
} from "../src/runtime/shared";

const { Element, Text, Fragment, Component } = VServerComponentType;

const text = (value: string): VServerComponentBuffered => [Text, value];
const el = (
  tag: string,
  children: BufferedChildren,
  props?: Record<string, unknown>,
): VServerComponentBuffered => [Element, tag, props, children];
const island = (
  slots?: MaybePromise<Record<string, BufferedChildren>>,
  props: Record<string, unknown> = { title: "hi" },
): VServerComponentBuffered => [Component, props, "/x/Island.vue", "default", slots];

describe("unrollServerComponentBufferPromises", () => {
  it("returns a Promise-free tree as is, without copying", async () => {
    const tree = el("ul", [el("li", [text("a")], { class: "x" }), el("li", [text("b")])]);
    expect(await unrollServerComponentBufferPromises(tree)).toBe(tree);
  });

  it("writes resolved Promises into the buffered tree in place", async () => {
    const children = [text("a"), Promise.resolve(text("b"))];
    const tree = el("div", children);
    expect(await unrollServerComponentBufferPromises(tree)).toBe(tree);
    expect(children[1]).toEqual(text("b"));
  });

  it("keeps undefined entries in a child list", async () => {
    const tree = el("div", [text("a"), undefined, Promise.resolve(text("b"))]);
    expect(await unrollServerComponentBufferPromises(tree)).toEqual(
      el("div", [text("a"), undefined, text("b")]),
    );
  });

  it("keeps undefined entries in a Promise child list", async () => {
    const tree = el("div", Promise.resolve([text("a"), undefined]));
    expect(await unrollServerComponentBufferPromises(tree)).toEqual(
      el("div", [text("a"), undefined]),
    );
  });

  it("resolves a Promise in a tuple slot as a list of children", async () => {
    const tree = el("div", Promise.resolve([text("a"), Promise.resolve(text("b"))]));
    expect(await unrollServerComponentBufferPromises(tree)).toEqual(
      el("div", [text("a"), text("b")]),
    );
  });

  it("resolves Promises inside a child list as tuples, keeping sync siblings", async () => {
    const tree = el("div", [
      text("sync"),
      Promise.resolve(el("span", [Promise.resolve(text("deep"))])),
      el("p", [text("also sync")]),
    ]);
    expect(await unrollServerComponentBufferPromises(tree)).toEqual(
      el("div", [text("sync"), el("span", [text("deep")]), el("p", [text("also sync")])]),
    );
  });

  it("resolves a Promise buffer and async slot bodies on component tuples", async () => {
    const tree = Promise.resolve<VServerComponentBuffered>([
      Fragment,
      [
        island({
          default: Promise.resolve([el("b", [Promise.resolve(text("slot"))])]),
          named: [text("sync slot")],
          empty: undefined,
        }),
      ],
    ]);
    expect(await unrollServerComponentBufferPromises(tree)).toEqual([
      Fragment,
      [
        island({
          default: [el("b", [text("slot")])],
          named: [text("sync slot")],
          empty: undefined,
        }),
      ],
    ]);
  });

  it("resolves a Promise slots object on a component tuple", async () => {
    const tree = island(Promise.resolve({ default: [Promise.resolve(text("slot"))] }));
    expect(await unrollServerComponentBufferPromises(tree)).toEqual(
      island({ default: [text("slot")] }),
    );
  });

  it("unrolls a component nested in another component's slot", async () => {
    const inner = island({ default: Promise.resolve([text("inner")]) });
    const tree = island({ default: [inner] });
    expect(await unrollServerComponentBufferPromises(tree)).toEqual(
      island({ default: [island({ default: [text("inner")] })] }),
    );
  });

  it("dedupes non-serializable prop warnings across nested components", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const props = { onClick: () => {} };
    await unrollServerComponentBufferPromises(
      island({ default: [island(undefined, props), island(undefined, props)] }, props),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
