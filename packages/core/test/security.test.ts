import { afterEach, describe, expect, it, vi } from "vitest";
import {
  serializePayloadForInline,
  unrollServerComponentBufferPromises,
} from "../src/runtime/serialize";
import { onigiriManifestPlugin } from "../src/vite/manifest";
import { VServerComponentType, type OnigiriPayload } from "../src/runtime/shared";

describe("serializePayloadForInline", () => {
  it("escapes script-context breakouts while staying JSON.parse-compatible", () => {
    const payload: OnigiriPayload = {
      v: 1,
      ast: [VServerComponentType.Text, `</script><script>alert(1)</script><!-- -->`],
    };
    const inline = serializePayloadForInline(payload);
    expect(inline).not.toContain("</script>");
    expect(inline).not.toContain("<");
    expect(JSON.parse(inline)).toEqual(payload);
  });
});

describe("manifest importFn hardening", () => {
  it("rejects protocol-relative URLs instead of importing cross-origin", async () => {
    const plugin = onigiriManifestPlugin({ stub: true }) as any;
    const code: string = plugin.load("\0virtual:onigiri/manifest");
    const mod = await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code)}`);
    await expect(mod.importFn("//evil.com/pwn.js")).rejects.toThrow(
      "[vue-onigiri] No loader registered for chunk \"//evil.com/pwn.js\"",
    );
  });
});

describe("v-load-client prop serializability warnings (dev)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const componentTuple = (props: Record<string, any>, chunk: string): any => [
    VServerComponentType.Component,
    props,
    chunk,
    "default",
    undefined,
  ];

  it("warns once per chunk+prop within a payload, for functions, class instances and cycles", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const cyclic: any = { a: 1 };
    cyclic.self = cyclic;
    const props = { formatter: () => {}, when: new Date(0), loop: cyclic };

    // Same island twice in one payload (v-for shape): deduped.
    await unrollServerComponentBufferPromises([
      VServerComponentType.Fragment,
      [componentTuple(props, "/x/Island.vue"), componentTuple(props, "/x/Island.vue")],
    ] as any);

    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("\"formatter\" (function)"))).toBe(true);
    expect(messages.some((m) => m.includes("\"when\" (Date instance)"))).toBe(true);
    expect(messages.some((m) => m.includes("\"loop.self\" (circular reference)"))).toBe(true);
    expect(messages.length).toBe(3);

    // A separate payload gets its own dedupe scope: warns again.
    await unrollServerComponentBufferPromises(componentTuple(props, "/x/Island.vue"));
    expect(warn.mock.calls.length).toBe(6);
  });

  it("stays silent for JSON-safe props", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await unrollServerComponentBufferPromises(
      componentTuple({ title: "hi", count: 2, tags: ["a"], nested: { ok: true } }, "/x/Safe.vue"),
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
