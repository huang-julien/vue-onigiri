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
    const toggled = spec.startsWith("/") ? spec.slice(1) : "/" + spec;
    return (
      spec in extraEntries || toggled in extraEntries || Object.values(extraEntries).includes(spec)
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
          `(e.g. { ${JSON.stringify(target)}: ${JSON.stringify(target)} }).`,
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
          id === "vue-onigiri/runtime/manifest-default" ||
          (/(^|[\\/])manifest-default(\.\w+)?$/.test(id) &&
            !!importer &&
            /[\\/]runtime[\\/]loader\.\w+$/.test(importer))
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
      const globExpressions =
        include === false
          ? []
          : [include.literalTargets, include.patterns]
              .filter((patterns) => patterns.length > 0)
              .map((patterns) => `import.meta.glob(${JSON.stringify(patterns)})`);
      const useGlob = globExpressions.length > 0;
      const glob =
        globExpressions.length === 1
          ? globExpressions[0]
          : `{\n${globExpressions.map((expression) => `  ...${expression},`).join("\n")}\n}`;
      const extras =
        extraEntries && Object.keys(extraEntries).length > 0
          ? `{\n${Object.entries(extraEntries)
              .map(
                ([key, spec]) => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(spec)}),`,
              )
              .join("\n")}\n}`
          : undefined;
      return `
${useGlob ? `const __glob = ${glob}\n` : ""}
${extras ? `const __extra = ${extras}\n` : ""}
export const manifest = ${useGlob ? "__glob" : "{}"}

// import() resolves the specifier as a URL, and the URL parser reads a backslash
// as the second slash, then deletes tab/newline/return before parsing at all. So
// a host can be spelled '//host/x', '/\\host/x' or '/<tab>/host/x'. Refuse all of
// them. Testing the raw string also covers a leading control character: the parser
// would trim it into one of those shapes, but startsWith('/') rejects it first.
const __isSameOriginPath = (src) =>
  src.startsWith('/') && src[1] !== '/' && src[1] !== '\\\\'
  && !src.includes('\\t') && !src.includes('\\n') && !src.includes('\\r')

export async function importFn(src, exportName = 'default') {
  const key = src.startsWith('/') ? src : '/' + src
  const loader = ${extras ? "__extra[src] ?? __extra[src.startsWith('/') ? src.slice(1) : key] ?? " : ""}${useGlob ? "__glob[key]" : "undefined"}
  if (loader) {
    const mod = await loader()
    return mod[exportName] ?? mod.default ?? mod
  }
  // Absolute URLs baked via \`resolveChunkUrl\` load through native import().
  if (__isSameOriginPath(src)) {
    try {
      const mod = await import(/* @vite-ignore */ src)
      return mod[exportName] ?? mod.default ?? mod
    } catch (cause) {
      throw new Error(
        '[vue-onigiri] Failed to load chunk "' + src + '": ' + (cause?.message ?? cause) + '. ' +
        'This descriptor is a source path unless the host baked a URL via \`resolveChunkUrl\`; ' +
        'it must be resolvable at runtime. '
      )
    }
  }
  throw new Error(
    '[vue-onigiri] No loader registered for chunk "' + src + '". ' +
    'Pass a custom \`importFn\` to \`renderOnigiri(ast, { importFn })\`, ' +
    'or set an \`include\` on \`onigiriManifestPlugin\`, ' +
    'or have the host bake a fetchable URL via \`resolveChunkUrl\`.'
  )
}
`;
    },
  };
}

/**
 * Convenience: returns just the manifest plugin in an array, so existing
 * `[...onigiriPlugins()]` callers keep working.
 */
export function onigiriPlugins(options: OnigiriManifestPluginOptions = {}): Plugin[] {
  return [onigiriManifestPlugin(options)];
}
