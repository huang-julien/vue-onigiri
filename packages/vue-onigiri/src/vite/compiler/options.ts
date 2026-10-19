import type { Rollup } from "vite";
import { toRootRelative } from "./paths";

/**
 * Component registered without a static import, such as a Nuxt auto-import or a global.
 */
export interface AdditionalImport {
  /**
   * File the component lives in, absolute or root-relative.
   */
  path: string;
}

/**
 * One `additionalImports` entry: the component file's path, bare or wrapped.
 */
export type AdditionalImportInput = string | AdditionalImport;

/**
 * User-facing `additionalImports` shapes accepted by the scan plugin.
 */
export type AdditionalImportsOption =
  | Record<string, AdditionalImportInput>
  | Map<string, AdditionalImportInput>
  | (() => Record<string, AdditionalImportInput> | Map<string, AdditionalImportInput>);

/**
 * Normalise any accepted `additionalImports` shape into a Map of `AdditionalImport`
 * with root-relative paths, matching the manifest glob keys. Paths outside `root` stay absolute.
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
    out.set(tag, { path: toRootRelative(entry.path, root) });
  }
  return out;
}

/**
 * Bundler resolver bound to a hook's plugin context, which differs per hook.
 */
export function makeResolveImport(ctx: Rollup.PluginContext) {
  return async (source: string, importer?: string) =>
    (await ctx.resolve(source, importer, { skipSelf: true }))?.id;
}

/**
 * All casings a template tag can resolve under: as written, PascalCase, camelCase and kebab-case.
 */
export function tagCasings(tag: string): string[] {
  const pascal = tag
    .replace(/-./g, (x) => x[1]?.toUpperCase() ?? "")
    .replace(/^./, (x) => x.toUpperCase());
  const camel = pascal.replace(/^./, (x) => x.toLowerCase());
  const kebab = tag.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase();
  return [tag, pascal, camel, kebab];
}
