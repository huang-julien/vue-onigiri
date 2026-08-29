import {
  genDynamicImport,
  genImport,
  genObjectFromRawEntries,
  genString,
  wrapInDelimiters,
} from "knitwork";
import type { Plugin } from "vite";
import { getOnigiriTargets, setOnigiriManifestInvalidator } from "./shared";

const MANIFEST_VIRTUAL_ID = "virtual:onigiri/manifest";
const MANIFEST_RESOLVED_ID = "\0" + MANIFEST_VIRTUAL_ID;

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
   * AST chunk references, values are bundler-resolved specifiers.
   */
  extraEntries?: Record<string, string>;
}

export interface OnigiriManifestPluginOptions extends OnigiriManifestOptions {
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
      candidateKeys(spec).some((key) => key in extraEntries) ||
      Object.values(extraEntries).includes(spec)
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
        `[vue-onigiri] v-load-client target "${target}" is a package specifier that ` +
          `\`import.meta.glob\` cannot cover, so no chunk is emitted for it. Add it to ` +
          `\`onigiriManifestPlugin\`'s \`extraEntries\` ` +
          `(e.g. { ${genString(target)}: ${genString(target)} }).`,
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

        const bareImporterPath = importer?.replace(/[?#].*$/, "");
        if (
          id === "vue-onigiri/runtime/manifest-default" ||
          (/(^|[\\/])manifest-default(\.\w+)?$/.test(id) &&
            !!bareImporterPath &&
            /[\\/]runtime[\\/]loader\.\w+$/.test(bareImporterPath))
        ) {
          return MANIFEST_RESOLVED_ID;
        }
      },
    },
    configureServer(server) {
      // Dev: a new v-load-client target invalidates the manifest module so the next request sees the fresh set.
      setOnigiriManifestInvalidator(() => {
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
      // Undefined `ssr` means server: only client bundles set the flag, explicitly to false.
      const isClient = opts?.ssr === false;
      // Optional-chained: tests and non-Rollup callers invoke `load` without a plugin context.
      const include = resolveInclude(isClient ? clientInclude : serverInclude, (message) =>
        this?.debug?.(message),
      );
      return `${genImport(MANIFEST_RUNTIME_ID, [{ name: "createImportFn", as: "__createImportFn" }])}

const __glob = ${genGlobTable(include)}
const __extra = ${genExtrasTable(extraEntries)}

export const manifest = __glob
export const importFn = __createImportFn(__glob, __extra)
`;
    },
  };
}

function candidateKeys(spec: string): [string, string] {
  return [spec, spec.startsWith("/") ? spec.slice(1) : "/" + spec];
}

/** `import.meta.glob(...)` for the resolved include, or an empty table. */
function genGlobTable(include: ResolvedInclude | false): string {
  if (include === false) return "{}";
  const expressions = [include.literalTargets, include.patterns]
    .filter((patterns) => patterns.length > 0)
    // Joined by hand: `genArrayFromRaw` would put each pattern on its own line.
    .map(
      (patterns) =>
        `import.meta.glob([${patterns.map((pattern) => genString(pattern)).join(",")}])`,
    );
  if (expressions.length === 0) return "{}";
  if (expressions.length === 1) return expressions[0]!;
  return wrapInDelimiters(expressions.map((expression) => `  ...${expression}`));
}

/** Literal `"key": () => import("spec")` loaders, or an empty table. */
function genExtrasTable(extraEntries: Record<string, string> | undefined): string {
  const entries = Object.entries(extraEntries ?? {});
  return genObjectFromRawEntries(entries.map(([key, spec]) => [key, genDynamicImport(spec)]));
}
