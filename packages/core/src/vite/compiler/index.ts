import type { Plugin, ResolvedConfig } from "vite";
import { ONIGIRI_PREFIX, ONIGIRI_SUFFIX } from "./constants";
import { loadVirtualOnigiriModule } from "./load-virtual";
import { injectIntoSetupAsync } from "./inject-setup";
import { attachAsProperty } from "./attach-property";
import type { AdditionalImport } from "../../template-compiler/codegen/context";
import { registerOnigiriTarget } from "../shared";
import { toRootRelative } from "./paths";

export type AdditionalImportInput = string | AdditionalImport;

export interface OnigiriCompilerOptions {
  /** @default true */
  sourceMap?: boolean;
  /**
   * Predicate for native custom elements / web components. Tags it
   * returns `true` for skip the Vue-component dispatch path and emit
   * as plain HTML elements — no `_resolveComponent` call. Mirrors
   * Vue's `CompilerOptions.isCustomElement`.
   */
  isCustomElement?: (tag: string) => boolean;
  /**
   * Tag → entry for components the SFC doesn't import statically.
   * Each entry is either a path string (defaulting to the `default`
   * export) or `{ path, export? }` for named exports. Lets
   * `v-load-client` resolve to the right chunk for Nuxt auto-imports,
   * globally-registered components, or any other case where the
   * compiler can't see the import in `<script>`. Provide either a
   * static map / object or a getter (re-evaluated per transform).
   */
  additionalImports?:
    | Record<string, AdditionalImportInput>
    | Map<string, AdditionalImportInput>
    | (() => Record<string, AdditionalImportInput> | Map<string, AdditionalImportInput>);
  /**
   * Optional build-time hook: returns the public chunk URL the client
   * should load for a given source path (e.g. `/components/Counter.vue`
   * → `/_nuxt/Counter-XXX.js`). When wired up, the compiler bakes the
   * URL into the AST so the SSR response never carries source paths
   * to the browser. Returning `undefined` keeps the source path, which
   * the runtime loader resolves via `import.meta.glob`. Re-evaluated
   * per transform, so a function that reads from a manifest filled in
   * after the client build will pick it up automatically.
   */
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
}

/**
 * Vite plugin that adds onigiri serialization support to Vue SFCs.
 *
 * - **Dev mode** (`.vue` no query, plugin-vue's combined output):
 *   imports a per-component virtual `__onigiriRender` from
 *   `virtual:onigiri:<path>.mjs` and attaches it to the SFC's default
 *   export.
 * - **Build mode** (`?vue&type=script` with inline template): injects an
 *   inline `__onigiriRender` returned by `setup()` when the
 *   `ONIGIRI_RENDER_SYMBOL` is provided, so it can capture the
 *   setup-script closure.
 */
export function onigiriCompilerPlugin(options: OnigiriCompilerOptions = {}): Plugin {
  const { sourceMap = true, isCustomElement, additionalImports, resolveChunkUrl } = options;
  let config: ResolvedConfig;

  const resolveAdditionalImports = (): Map<string, AdditionalImport> => {
    const raw = typeof additionalImports === "function" ? additionalImports() : additionalImports;
    if (!raw) return new Map();
    const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);
    const out = new Map<string, AdditionalImport>();
    for (const [tag, value] of entries) {
      out.set(tag, typeof value === "string" ? { path: value } : value);
    }
    return out;
  };

  return {
    name: "vite:vue-onigiri-compiler",
    // `enforce: 'post'` runs us after `@vitejs/plugin-vue` (so we see its
    // compiled output) but still before Vite's `vite:import-analysis` —
    // hook-level `transform: { order: 'post' }` would push us past it,
    // leaving `virtual:onigiri:*` specifiers unrewritten in the browser.
    enforce: "post",

    config() {
      return {
        optimizeDeps: {
          exclude: ["vue-onigiri"],
        },
      };
    },
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    resolveId: {
      order: "pre",
      async handler(id, importer) {
        if (id.startsWith(ONIGIRI_PREFIX) && id.endsWith(ONIGIRI_SUFFIX)) {
          return id;
        }

        // Defensive: encode + suffix a raw specifier (shouldn't normally happen).
        if (id.startsWith(ONIGIRI_PREFIX)) {
          const tail = id.slice(ONIGIRI_PREFIX.length);
          const encoded = /%[0-9A-Fa-f]{2}/.test(tail) ? tail : encodeURIComponent(tail);
          return ONIGIRI_PREFIX + encoded + ONIGIRI_SUFFIX;
        }

        if (importer?.startsWith(ONIGIRI_PREFIX) && importer.endsWith(ONIGIRI_SUFFIX)) {
          // Project-root-relative paths (`/app/components/Foo.vue`) come
          // from `additionalImports` (Nuxt auto-imports etc). Resolve
          // against the Vite root so Rollup can find them on disk.
          // Skip Windows-absolute (`/D:/…`) and `/@…` Vite-internal forms.
          if (
            id.startsWith("/") &&
            !id.startsWith("//") &&
            !id.startsWith("/@") &&
            !/^\/[A-Za-z]:/.test(id)
          ) {
            const abs = config.root.replace(/[/\\]+$/, "") + id;
            const resolved = await this.resolve(abs, undefined, { skipSelf: true });
            if (resolved) return resolved;
            return { id: abs };
          }
          // Anything else (relative `./Foo.vue` etc) resolves against
          // the original SFC the virtual module was built from.
          const encoded = importer.slice(ONIGIRI_PREFIX.length, -ONIGIRI_SUFFIX.length);
          const originalFilePath = decodeURIComponent(encoded);
          return await this.resolve(id, originalFilePath, { skipSelf: true });
        }

        return null;
      },
    },

    async load(id) {
      if (id.includes("devtools")) return null;
      return loadVirtualOnigiriModule(
        id,
        {
          config,
          sourceMap,
          isCustomElement,
          additionalImports: resolveAdditionalImports(),
          resolveChunkUrl,
          registerTarget: registerOnigiriTarget,
        },
        (msg) => this.error(msg),
      );
    },

    transform: {
      async handler(code, id) {
        const [filePath, query] = id.split("?");
        if (!filePath || !filePath.endsWith(".vue") || filePath.startsWith(ONIGIRI_PREFIX)) {
          return null;
        }

        // Bare `.vue` (dev split-module path AND build mode): plugin-vue
        // re-exports script + template (dev) or just the inline-render
        // script (build). In both modes, attaching to the SFC default
        // export lands on the canonical module — the descriptor here
        // travels with the SFC wherever it's imported, so the runtime
        // serializer can look up the chunk URL from the component
        // instead of relying on a call-site-baked fallback.
        if (!query) {
          if (!code.includes("export default")) return null;
          const onigiriImport = `${ONIGIRI_PREFIX}${encodeURIComponent(filePath)}${ONIGIRI_SUFFIX}`;
          const sourcePath = toRootRelative(filePath, config.root);
          const descriptorChunk = resolveChunkUrl?.(sourcePath) ?? sourcePath;
          return attachAsProperty(code, onigiriImport, sourceMap, descriptorChunk);
        }

        // `?vue&type=script` with inline template (build mode): the SSR
        // render closes over setup-script bindings and `setupState` is
        // empty, so an external render can't reach them. Inject our
        // render INSIDE setup so it shares the closure.
        if (query.includes("type=script")) {
          const hasInlineTemplate =
            code.includes("_createElementVNode") ||
            code.includes("_createVNode") ||
            code.includes("_createBlock") ||
            code.includes("ssrInterpolate") ||
            code.includes("ssrRenderAttrs");
          if (hasInlineTemplate) {
            return injectIntoSetupAsync(
              code,
              filePath,
              sourceMap,
              config,
              isCustomElement,
              resolveAdditionalImports(),
              resolveChunkUrl,
              registerOnigiriTarget,
            );
          }
          return null;
        }

        return null;
      },
    },
  };
}

export default onigiriCompilerPlugin;
