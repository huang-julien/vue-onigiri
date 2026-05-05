import type { Plugin, ResolvedConfig } from "vite";
import { ONIGIRI_PREFIX, ONIGIRI_SUFFIX } from "./constants";
import { loadVirtualOnigiriModule } from "./load-virtual";
import { injectIntoSetupAsync } from "./inject-setup";
import { attachAsProperty } from "./attach-property";

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
   * Tag → root-relative module path for components the SFC doesn't
   * import statically. Lets `v-load-client` resolve to the right
   * chunk for Nuxt auto-imports, globally-registered components, or
   * any other case where the compiler can't see the import in
   * `<script>`. Provide either a static map or a getter (re-evaluated
   * per transform; cheap to swap out from a parent module that
   * collects component info dynamically — e.g. the Nuxt module).
   */
  additionalImports?:
    | Record<string, string>
    | Map<string, string>
    | (() => Record<string, string> | Map<string, string>);
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
  const { sourceMap = true, isCustomElement, additionalImports } = options;
  let config: ResolvedConfig;

  const resolveAdditionalImports = (): Map<string, string> => {
    const raw = typeof additionalImports === "function" ? additionalImports() : additionalImports;
    if (!raw) return new Map();
    return raw instanceof Map ? raw : new Map(Object.entries(raw));
  };

  return {
    name: "vite:vue-onigiri-compiler",
    // `enforce: 'post'` runs us after `@vitejs/plugin-vue` (so we see its
    // compiled output) but still before Vite's `vite:import-analysis` —
    // hook-level `transform: { order: 'post' }` would push us past it,
    // leaving `virtual:onigiri:*` specifiers unrewritten in the browser.
    enforce: "post",

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

        // Relative imports inside a virtual onigiri module resolve
        // against the original (decoded) file path on disk.
        if (importer?.startsWith(ONIGIRI_PREFIX) && importer.endsWith(ONIGIRI_SUFFIX)) {
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
        { config, sourceMap, isCustomElement, additionalImports: resolveAdditionalImports() },
        (msg) => this.error(msg),
      );
    },

    transform: {
      async handler(code, id) {
        const [filePath, query] = id.split("?");
        if (!filePath || !filePath.endsWith(".vue") || filePath.startsWith(ONIGIRI_PREFIX)) {
          return null;
        }

        // Bare `.vue` (dev split-module path): plugin-vue re-exports
        // script + template, so an external `__onigiriRender` reading
        // bindings via `_ctx.foo` works against the populated setupState.
        if (!query) {
          if (!code.includes("export default")) return null;
          const onigiriImport = `${ONIGIRI_PREFIX}${encodeURIComponent(filePath)}${ONIGIRI_SUFFIX}`;
          return attachAsProperty(code, onigiriImport, sourceMap);
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
