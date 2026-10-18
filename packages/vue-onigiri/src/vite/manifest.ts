import { genDynamicImport, genImport, genObjectFromRawEntries, genString } from "knitwork";
import type { Plugin } from "vite";
import { chunkKeys } from "../shared/chunk-keys";
import { type OnigiriRegistryOption, sharedOnigiriRegistry } from "./shared";

/**
 * Glob selection for one manifest environment: explicit patterns, or
 * `"auto"` for the scanned `v-load-client` targets, alone or in an array.
 *
 * @remarks `false` disables the glob.
 */
export type OnigiriManifestInclude = "auto" | string | string[] | false;

export interface OnigiriManifestOptions {
  /**
   * Selects which source files the server manifest can load.
   *
   * @default "auto"
   */
  serverInclude?: OnigiriManifestInclude;
  /**
   * Selects which source files the client manifest can load.
   *
   * @remarks `false` means a source-path descriptor reaching the browser needs a custom `importFn`.
   * @default false
   */
  clientInclude?: OnigiriManifestInclude;
  /**
   * Adds literal loader entries, consulted before the glob, for chunk
   * references a glob cannot express, typically package components. Keys are
   * marker chunk references, values are bundler-resolved specifiers.
   */
  extraEntries?: Record<string, string>;
}

export interface OnigiriManifestPluginOptions
  extends OnigiriManifestOptions, OnigiriRegistryOption {
  /**
   * Emits a manifest without `import.meta.glob` in every environment, for
   * bundlers that can't preprocess it or compile `.vue` imports, such as
   * Nitro's pure-Node rollup.
   *
   * @default false
   */
  stub?: boolean;
}

interface ResolvedInclude {
  /**
   * User glob patterns, emitted as one `import.meta.glob`.
   */
  patterns: string[];
  /**
   * Scanned root-relative targets, emitted as literal loaders.
   */
  targets: string[];
}

const MANIFEST_ID = "vue-onigiri/manifest";
const MANIFEST_VIRTUAL_ID = "virtual:onigiri/manifest";
const MANIFEST_RESOLVED_ID = "\0" + MANIFEST_VIRTUAL_ID;
const MANIFEST_RUNTIME_ID = "vue-onigiri";

/**
 * Replace the `vue-onigiri/manifest` stub with a generated module exporting
 * `manifest` and `importFn`, which resolves a chunk reference via literal
 * entries, then glob, then native `import()` for absolute URLs, then a diagnostic throw.
 */
export function onigiriManifestPlugin(options: OnigiriManifestPluginOptions = {}): Plugin {
  const stub = options.stub ?? false;
  const registry = options.registry ?? sharedOnigiriRegistry;
  const serverInclude: OnigiriManifestInclude = stub ? false : (options.serverInclude ?? "auto");
  const clientInclude: OnigiriManifestInclude = stub ? false : (options.clientInclude ?? false);
  // Stub exists for bundlers that can't compile `.vue` imports, which a literal entry is too.
  const extraEntries = stub ? undefined : options.extraEntries;

  // Once-per-spec guard for the bare-specifier diagnostic below.
  const loggedBareTargets = new Set<string>();

  const extrasCover = (spec: string): boolean => {
    if (!extraEntries) return false;
    return (
      chunkKeys(spec).some((key) => Object.hasOwn(extraEntries, key)) ||
      Object.values(extraEntries).includes(spec)
    );
  };

  const resolveInclude = (
    include: OnigiriManifestInclude,
    debug?: (message: string) => void,
  ): ResolvedInclude => {
    if (include === false) return { patterns: [], targets: [] };
    const patterns = Array.isArray(include) ? include : [include];
    const scanned = patterns.includes("auto") ? registry.targets() : [];

    // Bare package specifiers can't be source paths; they need an `extraEntries` entry.
    for (const target of scanned) {
      if (target.startsWith("/") || extrasCover(target) || loggedBareTargets.has(target)) {
        continue;
      }
      loggedBareTargets.add(target);
      debug?.(
        `[vue-onigiri] v-load-client target "${target}" is a package specifier that ` +
          `the manifest cannot import by source path, so no chunk is emitted for it. Add it to ` +
          `\`onigiriManifestPlugin\`'s \`extraEntries\` ` +
          `(e.g. { ${genString(target)}: ${genString(target)} }).`,
      );
    }

    return {
      patterns: patterns.filter((pattern) => pattern !== "auto"),
      // Literal so glob metacharacters in a path (`[id].vue`, `(group)`) are not patterns.
      targets: scanned.filter((target) => target.startsWith("/") && !extrasCover(target)),
    };
  };

  return {
    name: "vite:vue-onigiri-manifest",
    // Claim the ids before default resolvers externalize them, which crashes Nitro's rollup.
    resolveId: {
      order: "pre",
      handler(id) {
        if (id === MANIFEST_ID || id === MANIFEST_VIRTUAL_ID) return MANIFEST_RESOLVED_ID;
      },
    },
    configureServer(server) {
      // Dev: a new v-load-client target invalidates the manifest module so the next request sees the fresh set.
      registry.setInvalidator(() => {
        const mod =
          server.environments.ssr?.moduleGraph.getModuleById(MANIFEST_RESOLVED_ID) ??
          server.environments.client?.moduleGraph.getModuleById(MANIFEST_RESOLVED_ID);
        if (mod) {
          server.environments.ssr?.moduleGraph.invalidateModule(mod);
          server.environments.client?.moduleGraph.invalidateModule(mod);
        }
      });
    },
    load(id, opts) {
      if (id !== MANIFEST_RESOLVED_ID) return;
      // Optional-chained: tests and non-Rollup callers invoke `load` without a plugin context.
      const consumer = this?.environment?.config.consumer;
      const isClient = consumer ? consumer === "client" : opts?.ssr === false;
      const include = resolveInclude(isClient ? clientInclude : serverInclude, (message) =>
        this?.debug?.(message),
      );
      // `importFn` builds lazily: the root entry imports this module, so its exports may not be live yet.
      return `${genImport(MANIFEST_RUNTIME_ID, [{ name: "createImportFn", as: "__createImportFn" }])}

const __glob = ${genGlobTable(include.patterns)}
const __extra = ${genExtrasTable(extraEntries, include.targets)}

export const manifest = { ...__glob, ...__extra }
let __importFn
export const importFn = (src, exportName) => (__importFn ??= __createImportFn(__glob, __extra))(src, exportName)
export { __createImportFn as createImportFn }
`;
    },
  };
}

/**
 * `import.meta.glob(...)` of the user patterns, or an empty table.
 */
function genGlobTable(patterns: string[]): string {
  if (patterns.length === 0) return "{}";
  // Joined by hand: `genArrayFromRaw` would put each pattern on its own line.
  return `import.meta.glob([${patterns.map((pattern) => genString(pattern)).join(",")}])`;
}

/**
 * Literal `"key": () => import("spec")` loaders for `extraEntries` and scanned targets, or an empty table.
 */
function genExtrasTable(
  extraEntries: Record<string, string> | undefined,
  targets: readonly string[],
): string {
  const entries: [string, string][] = Object.entries(extraEntries ?? {});
  for (const target of targets) entries.push([target, target]);
  return genObjectFromRawEntries(entries.map(([key, spec]) => [key, genDynamicImport(spec)]));
}
