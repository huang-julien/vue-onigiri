import type { Plugin } from "vite";
import { getOnigiriTargets, setOnigiriManifestInvalidator } from "./shared";

const MANIFEST_VIRTUAL_ID = "virtual:onigiri/manifest";
const MANIFEST_RESOLVED_ID = "\0" + MANIFEST_VIRTUAL_ID;

export type OnigiriManifestInclude = "auto" | string | string[] | false;

export interface OnigiriManifestOptions {
  /**
   * Server `__glob`: `"auto"` includes scanned v-load-client targets;
   * include it in an array to combine them with explicit patterns.
   *
   * @default "auto"
   */
  serverInclude?: OnigiriManifestInclude;
  /**
   * Client `__glob`, same shape as `serverInclude`; when `false`, a
   * source-path descriptor reaching the browser needs a custom `importFn`.
   *
   * @default false
   */
  clientInclude?: OnigiriManifestInclude;
  /**
   * Literal `"key": () => import("spec")` loader entries consulted before
   * the glob, for chunk references a glob cannot express — typically package
   * components: the key is the AST chunk reference (leading-slash tolerant),
   * the value is a bundler-resolved specifier, so aliases work.
   */
  extraEntries?: Record<string, string>;
}

export interface OnigiriManifestPluginOptions extends OnigiriManifestOptions {
  /**
   * Force a no-glob manifest in all environments, required for bundlers
   * that can't preprocess `import.meta.glob` or compile `.vue` imports
   * (e.g. Nitro's pure-Node rollup).
   *
   * @default false
   */
  stub?: boolean;
}

interface ResolvedInclude {
  literalTargets: string[];
  patterns: string[];
}

const MANIFEST_RUNTIME_ID = "vue-onigiri/runtime/manifest-runtime";

/**
 * Emit the `virtual:onigiri/manifest` module exporting `manifest` and
 * `importFn`, which resolves a chunk reference via extras, then glob,
 * then native `import()` for absolute URLs, then a diagnostic throw.
 */
export function onigiriManifestPlugin(options: OnigiriManifestPluginOptions = {}): Plugin {
  const stub = options.stub ?? false;
  const serverInclude: OnigiriManifestInclude = stub ? false : (options.serverInclude ?? "auto");
  const clientInclude: OnigiriManifestInclude = stub ? false : (options.clientInclude ?? false);
  // Stub exists for bundlers that can't compile `.vue` imports, which a literal entry is too.
  const extraEntries = stub ? undefined : options.extraEntries;

  // Once-per-spec guard for the bare-specifier diagnostic below.
  const loggedBareTargets = new Set<string>();

  const extrasCover = (spec: string): boolean => {
    if (!extraEntries) return false;
    return (
      candidateKeys(spec).some((key) => key in extraEntries)
      || Object.values(extraEntries).includes(spec)
    );
  };

  const resolveInclude = (
    include: OnigiriManifestInclude,
    debug?: (message: string) => void,
  ): ResolvedInclude | false => {
    if (include === false) return false;
    const patterns = Array.isArray(include) ? include : [include];
    const hasAuto = patterns.includes("auto");
    const explicitPatterns = patterns.filter((pattern) => pattern !== "auto");
    const targets = hasAuto ? getOnigiriTargets() : [];

    // Bare package specifiers can't be glob patterns; they need a literal entry.
    const literalTargets = targets.filter((target) => target.startsWith("/"));
    for (const target of targets) {
      if (target.startsWith("/") || extrasCover(target) || loggedBareTargets.has(target)) {
        continue;
      }
      loggedBareTargets.add(target);
      debug?.(
        `[vue-onigiri] v-load-client target "${target}" is a package specifier that `
        + `\`import.meta.glob\` cannot cover, so no chunk is emitted for it. Add it to `
        + `\`onigiriManifestPlugin\`'s \`extraEntries\` `
        + `(e.g. { ${JSON.stringify(target)}: ${JSON.stringify(target)} }).`,
      );
    }

    return literalTargets.length > 0 || explicitPatterns.length > 0
      ? { literalTargets, patterns: explicitPatterns }
      : false;
  };

  return {
    name: "vite:vue-onigiri-manifest",
    // Claim the id before default resolvers externalize the `virtual:` protocol, which crashes Nitro's rollup.
    resolveId: {
      order: "pre",
      handler(id, importer) {
        if (id === MANIFEST_VIRTUAL_ID) return MANIFEST_RESOLVED_ID;

        if (
          id === "vue-onigiri/runtime/manifest-default"
          || (/(^|[\\/])manifest-default(\.\w+)?$/.test(id)
            && !!importer
            && /[\\/]runtime[\\/]loader\.\w+$/.test(importer))
        ) {
          return MANIFEST_RESOLVED_ID;
        }
      },
    },
    configureServer(server) {
      // Dev: a new v-load-client target invalidates the manifest module so the next request sees the fresh set.
      setOnigiriManifestInvalidator(() => {
        const mod
          = server.environments.ssr?.moduleGraph.getModuleById(MANIFEST_RESOLVED_ID)
            ?? server.environments.client?.moduleGraph.getModuleById(MANIFEST_RESOLVED_ID);
        if (mod) {
          server.environments.ssr?.moduleGraph.invalidateModule(mod);
          server.environments.client?.moduleGraph.invalidateModule(mod);
        }
      });
    },
    load(id, opts) {
      if (id !== MANIFEST_RESOLVED_ID) return;
      // Undefined `ssr` means server: only client bundles set the flag, explicitly to false.
      const isClient = opts?.ssr === false;
      // Optional-chained: tests and non-Rollup callers invoke `load` without a plugin context.
      const include = resolveInclude(isClient ? clientInclude : serverInclude, (message) =>
        this?.debug?.(message),
      );
      return `import { createImportFn as __createImportFn } from ${JSON.stringify(MANIFEST_RUNTIME_ID)}

const __glob = ${genGlobTable(include)}
const __extra = ${genExtrasTable(extraEntries)}

export const manifest = __glob
export const importFn = __createImportFn(__glob, __extra)
`;
    },
  };
}

export function onigiriPlugins(options: OnigiriManifestPluginOptions = {}): Plugin[] {
  return [onigiriManifestPlugin(options)];
}

function candidateKeys(spec: string): [string, string] {
  return [spec, spec.startsWith("/") ? spec.slice(1) : "/" + spec];
}

/** `import.meta.glob(...)` for the resolved include, or an empty table. */
function genGlobTable(include: ResolvedInclude | false): string {
  if (include === false) return "{}";
  const expressions = [include.literalTargets, include.patterns]
    .filter((patterns) => patterns.length > 0)
    .map((patterns) => `import.meta.glob(${JSON.stringify(patterns)})`);
  if (expressions.length === 0) return "{}";
  if (expressions.length === 1) return expressions[0]!;
  return `{\n${expressions.map((expression) => `  ...${expression},`).join("\n")}\n}`;
}

/** Literal `"key": () => import("spec")` loaders, or an empty table. */
function genExtrasTable(extraEntries: Record<string, string> | undefined): string {
  const entries = Object.entries(extraEntries ?? {});
  if (entries.length === 0) return "{}";
  const properties = entries
    .map(([key, spec]) => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(spec)}),`)
    .join("\n");
  return `{\n${properties}\n}`;
}
