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
  const BACKSLASH = String.fromCharCode(92);
  const TAB = String.fromCharCode(9);
  const NEWLINE = String.fromCharCode(10);
  const RETURN = String.fromCharCode(13);

  const loadImportFn = async (options?: Record<string, unknown>) => {
    const plugin = onigiriManifestPlugin(options ?? { stub: true }) as any;
    const code: string = plugin.load("\0virtual:onigiri/manifest");
    return await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code)}`);
  };

  // Every spelling below resolves to https://evil.com through the URL parser,
  // which strips tab/newline before parsing and treats `\` as a second `/`.
  const CROSS_ORIGIN = [
    "//evil.com/pwn.js",
    `/${BACKSLASH}evil.com/pwn.js`,
    `/${BACKSLASH}${BACKSLASH}evil.com/pwn.js`,
    `/${TAB}/evil.com/pwn.js`,
    `/${NEWLINE}/evil.com/pwn.js`,
    `/${RETURN}/evil.com/pwn.js`,
  ];

  it.each(CROSS_ORIGIN)("refuses %j instead of importing cross-origin", async (src) => {
    // Guards against a fix that only handles the spellings we thought of.
    expect(new URL(src, "https://app.example.com/page").origin).toBe("https://evil.com");

    const mod = await loadImportFn();
    await expect(mod.importFn(src)).rejects.toThrow("No loader registered for chunk");
  });

  // The import() fallback exists for URLs a host baked via `resolveChunkUrl`;
  // hardening it must not start refusing those.
  it.each([
    "/_nuxt/Counter.DhSf1sT2.js",
    "/components/Counter.vue",
    "/x/My Component.vue",
    "/x/Foo.vue?v=123",
  ])("still attempts a same-origin descriptor %j", async (src) => {
    const mod = await loadImportFn();
    // No module resolver under Node, so reaching import() surfaces as the
    // load error rather than the "no loader" refusal.
    await expect(mod.importFn(src)).rejects.toThrow("Failed to load chunk");
  });

  it("keeps the guard identical once globs and extras are present", async () => {
    const mod = await loadImportFn({
      serverInclude: false,
      extraEntries: { "/x/Pkg.vue": "pkg/Comp.vue" },
    });
    await expect(mod.importFn(`/${BACKSLASH}evil.com/pwn.js`)).rejects.toThrow(
      "No loader registered for chunk",
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
