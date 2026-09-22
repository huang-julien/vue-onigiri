import type { Rollup } from "vite";
import type { AdditionalImport } from "../../template-compiler/codegen/context";
import { toRootRelative } from "./paths";

export type AdditionalImportInput = string | AdditionalImport;

/** User-facing `additionalImports` shapes accepted by the compiler and scan plugins. */
export type AdditionalImportsOption =
  | Record<string, AdditionalImportInput>
  | Map<string, AdditionalImportInput>
  | (() => Record<string, AdditionalImportInput> | Map<string, AdditionalImportInput>);

/**
 * Normalise any accepted `additionalImports` shape into a Map of `AdditionalImport`
 * with root-relative paths, matching the manifest glob keys and the resolveId root join.
 * Paths outside `root` stay absolute.
 */
export function resolveAdditionalImports(
  raw: AdditionalImportsOption | undefined,
  root: string,
): Map<string, AdditionalImport> {
  const resolved = typeof raw === "function" ? raw() : raw;
  if (!resolved) return new Map();
  const entries = resolved instanceof Map ? [...resolved.entries()] : Object.entries(resolved);
  const out = new Map<string, AdditionalImport>();
  for (const [tag, value] of entries) {
    const entry = typeof value === "string" ? { path: value } : value;
    out.set(tag, { path: toRootRelative(entry.path, root), export: entry.export });
  }
  return out;
}

/** Bundler resolver bound to a hook's plugin context, which differs per hook. */
export function makeResolveImport(ctx: Rollup.PluginContext) {
  return async (source: string, importer?: string) =>
    (await ctx.resolve(source, importer, { skipSelf: true }))?.id;
}
