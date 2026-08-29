import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Plugin, ResolvedConfig } from "vite";
import { generateScopeId } from "../src/vite/compiler/scope-id";
import { onigiriCompilerPlugin } from "../src/vite/compiler";
import { onigiriPlugins } from "../src/vite/plugins";
import { ONIGIRI_PREFIX, ONIGIRI_SUFFIX } from "../src/vite/compiler/constants";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = path.resolve(ROOT, "test/fixtures/components/ScopedStyle.vue");
const SOURCE = readFileSync(FIXTURE, "utf8");

/** plugin-vue's derivation: sha256 of the slash-relative path (+ source in prod), 8 hex chars. */
function pluginVueScopeId(isProduction: boolean): string {
  const relativePath = path.relative(ROOT, FIXTURE).replaceAll("\\", "/");
  const hashInput = isProduction ? relativePath + SOURCE : relativePath;
  return `data-v-${createHash("sha256").update(hashInput).digest("hex").slice(0, 8)}`;
}

async function loadVirtualScoped(plugin: Plugin, configIsProduction: boolean): Promise<string> {
  (plugin.configResolved as (c: ResolvedConfig) => void).call(plugin, {
    root: ROOT,
    isProduction: configIsProduction,
  } as ResolvedConfig);

  const load = plugin.load as (this: unknown, id: string) => Promise<{ code: string } | null>;
  const result = await load.call(
    {
      resolve: async (id: string) => ({ id }),
      error: (msg: string) => {
        throw new Error(msg);
      },
    },
    ONIGIRI_PREFIX + encodeURIComponent(FIXTURE) + ONIGIRI_SUFFIX,
  );
  return result!.code;
}

describe("generateScopeId plugin-vue parity", () => {
  it("hashes the relative path only in development", () => {
    expect(generateScopeId(FIXTURE, SOURCE, ROOT, false)).toBe(pluginVueScopeId(false));
  });

  it("hashes the relative path plus source in production", () => {
    expect(generateScopeId(FIXTURE, SOURCE, ROOT, true)).toBe(pluginVueScopeId(true));
  });

  it("supports the 'filepath' generator regardless of mode", () => {
    expect(generateScopeId(FIXTURE, SOURCE, ROOT, true, "filepath")).toBe(pluginVueScopeId(false));
  });

  it("supports the 'filepath-source' generator regardless of mode", () => {
    expect(generateScopeId(FIXTURE, SOURCE, ROOT, false, "filepath-source")).toBe(
      pluginVueScopeId(true),
    );
  });

  it("calls a custom generator with plugin-vue's argument shape", () => {
    const calls: unknown[][] = [];
    const id = generateScopeId(FIXTURE, SOURCE, ROOT, true, (filepath, source, isProd, getHash) => {
      calls.push([filepath, source, isProd]);
      return getHash(`${filepath}|custom`);
    });

    const relativePath = path.relative(ROOT, FIXTURE).replaceAll("\\", "/");
    expect(calls).toEqual([[relativePath, SOURCE, true]]);
    const expected = createHash("sha256")
      .update(`${relativePath}|custom`)
      .digest("hex")
      .slice(0, 8);
    expect(id).toBe(`data-v-${expected}`);
  });
});

describe("isProduction compiler option", () => {
  it("pins production mode even when NODE_ENV says otherwise", async () => {
    // vitest sets NODE_ENV=test, the exact host scenario the option exists for.
    expect(process.env.NODE_ENV).toBe("test");

    const code = await loadVirtualScoped(onigiriCompilerPlugin({ isProduction: true }), false);
    expect(code).toContain(pluginVueScopeId(true));
    expect(code).not.toContain(pluginVueScopeId(false));
  });

  it("pins development mode over a production config", async () => {
    const code = await loadVirtualScoped(onigiriCompilerPlugin({ isProduction: false }), true);
    expect(code).toContain(pluginVueScopeId(false));
  });

  it("falls back to config.isProduction=false when unset", async () => {
    const code = await loadVirtualScoped(onigiriCompilerPlugin(), false);
    expect(code).toContain(pluginVueScopeId(false));
  });

  it("falls back to config.isProduction=true when unset", async () => {
    const code = await loadVirtualScoped(onigiriCompilerPlugin(), true);
    expect(code).toContain(pluginVueScopeId(true));
  });

  it("is forwarded by onigiriPlugins() to the compiler plugin", async () => {
    const compiler = onigiriPlugins({ isProduction: true }).find(
      (p) => p.name === "vite:vue-onigiri-compiler",
    )!;
    const code = await loadVirtualScoped(compiler, false);
    expect(code).toContain(pluginVueScopeId(true));
  });

  it("forwards componentIdGenerator through onigiriPlugins()", async () => {
    const compiler = onigiriPlugins({ componentIdGenerator: "filepath" }).find(
      (p) => p.name === "vite:vue-onigiri-compiler",
    )!;
    const code = await loadVirtualScoped(compiler, true);
    expect(code).toContain(pluginVueScopeId(false));
  });
});
