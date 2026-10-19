import type { DefineComponent } from "vue";
import { chunkKeys } from "../shared/chunk-keys";
import type { ImportFn } from "./utils";

/**
 * Chunk descriptor to module loader, the shape `import.meta.glob` and `extraEntries` both produce.
 */
export type ChunkTable = Record<string, () => Promise<unknown>>;

/**
 * Build an `importFn` resolving a chunk through `extra`, then `glob`, then a
 * native `import()` for same-origin absolute URLs, and throwing a diagnostic otherwise.
 */
export function createImportFn(glob: ChunkTable, extra: ChunkTable): ImportFn {
  return async (src, exportName = "default") => {
    const loader = resolveLoader([extra, glob], src);
    if (loader) {
      const mod = (await loader()) as Record<string, unknown>;
      return (mod[exportName] ?? mod.default ?? mod) as DefineComponent;
    }

    // Absolute URLs baked via `resolveChunkUrl` load through native import().
    if (isSameOriginPath(src)) {
      try {
        const mod = (await import(/* @vite-ignore */ src)) as Record<string, unknown>;
        return (mod[exportName] ?? mod.default ?? mod) as DefineComponent;
      } catch (error_) {
        throw new Error(
          `[vue-onigiri] Failed to load chunk "${src}": ${(error_ as Error)?.message ?? error_}. ` +
            `This descriptor is a source path unless the host baked a URL via \`resolveChunkUrl\`; ` +
            `it must be resolvable at runtime. `,
          { cause: error_ },
        );
      }
    }

    throw new Error(
      `[vue-onigiri] No loader registered for chunk "${src}". ` +
        `Pass a custom \`importFn\` to \`domToVNode(el, { nonce, importFn })\`, ` +
        `or set an \`include\` on \`onigiriManifestPlugin\`, ` +
        `or have the host bake a fetchable URL via \`resolveChunkUrl\`.`,
    );
  };
}

function isSameOriginPath(src: string): boolean {
  return (
    src.startsWith("/") &&
    src[1] !== "/" &&
    src[1] !== "\\" &&
    !src.includes("\t") &&
    !src.includes("\n") &&
    !src.includes("\r")
  );
}

function resolveLoader(
  tables: readonly ChunkTable[],
  src: string,
): (() => Promise<unknown>) | undefined {
  const keys = chunkKeys(src);
  for (const table of tables) {
    for (const key of keys) {
      if (Object.hasOwn(table, key)) return table[key];
    }
  }
  return undefined;
}
