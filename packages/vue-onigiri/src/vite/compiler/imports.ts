import path from "node:path";
import type { SFCScriptBlock } from "@vue/compiler-sfc";
import { toRootRelative } from "./paths";

/**
 * `compileScript`'s `ImportBinding` records keyed by local identifier; the element type itself is not exported by @vue/compiler-sfc.
 */
export type ScriptImports = NonNullable<SFCScriptBlock["imports"]>;

/**
 * Bundler resolver (`PluginContext.resolve` bound to the importing SFC).
 */
export type ResolveImportFn = (source: string) => Promise<string | null | undefined>;

/**
 * Map each `<script>` import's local identifier to the chunk path baked into v-load-client tuples (e.g. `Foo` → `/components/Foo.vue`).
 * Sources go through the bundler resolver when available, so aliases and package imports resolve.
 * Resolutions under `root` become root-relative paths; package resolutions (node_modules or out-of-root, e.g. workspace links) keep their bare specifier.
 * Without a resolver, relative imports fall back to plain path joining.
 */
export async function buildImportMap(
  imports: ScriptImports | undefined,
  currentFilePath: string,
  root: string,
  resolveImport?: ResolveImportFn,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!imports) return map;

  const chunkPaths = new Map<string, string | undefined>();
  for (const binding of Object.values(imports)) {
    // Types are erased and a namespace object is never a component reference.
    if (binding.isType || binding.imported === "*") continue;

    if (!chunkPaths.has(binding.source)) {
      chunkPaths.set(
        binding.source,
        await resolveImportSource(binding.source, currentFilePath, root, resolveImport),
      );
    }
    const chunkPath = chunkPaths.get(binding.source);
    if (chunkPath) map.set(binding.local, chunkPath);
  }
  return map;
}

async function resolveImportSource(
  source: string,
  currentFilePath: string,
  root: string,
  resolveImport?: ResolveImportFn,
): Promise<string | undefined> {
  const isRelative = source.startsWith("./") || source.startsWith("../");

  if (resolveImport) {
    const resolved = await resolveImport(source);
    if (resolved) {
      const clean = resolved.split("?")[0]!;
      const rel = toRootRelative(clean, root);
      const outOfRoot = rel === normalizePath(clean);
      // Package files can't be glob keys, so the bare specifier stays
      // mappable by the host. Out-of-root covers workspace-linked packages,
      // whose realpath escapes both node_modules and the root.
      if (!isRelative && (clean.includes("node_modules") || outOfRoot)) {
        return source;
      }
      return rel;
    }
  }

  if (!isRelative) return undefined;

  const abs = path.resolve(path.dirname(currentFilePath), source);
  return "/" + normalizePath(path.relative(root, abs));
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}
