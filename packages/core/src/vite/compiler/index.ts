import { existsSync } from "node:fs";
import type { Plugin, ResolvedConfig } from "vite";
import { ONIGIRI_PREFIX, ONIGIRI_SUFFIX } from "./constants";
import { loadVirtualOnigiriModule } from "./load-virtual";
import { injectIntoSetupAsync } from "./inject-setup";
import { attachAsProperty } from "./attach-property";
import type { AdditionalImport } from "../../template-compiler/codegen/context";
import { registerOnigiriTarget } from "../shared";
import { toRootRelative } from "./paths";

/**
 * Detect whether plugin-vue's output already inlines a render function
 * (client or SSR shape); both need the setup-bridge injection so the
 * onigiri render closes over setup-script bindings.
 */
function hasInlineTemplate(code: string): boolean {
  return (
    // Client render-fn codegen
    code.includes("_createElementVNode")
    || code.includes("_createVNode")
    || code.includes("_createBlock")
    || code.includes("_createElementBlock")
    || code.includes("ssrInterpolate")
    || code.includes("ssrRenderAttrs")
    // SSR render-fn codegen (production build, ?vue&type=template SSR sub-module)
    || code.includes("_push(`<")
    || code.includes("_push(ssr")
    || code.includes("ssrRenderComponent")
    || code.includes("ssrRenderSlot")
    || code.includes("ssrRenderList")
    || code.includes("ssrRenderClass")
    || code.includes("ssrRenderStyle")
    || code.includes("ssrRenderVNode")
  );
}

export type AdditionalImportInput = string | AdditionalImport;

export interface OnigiriCompilerOptions {
  /** @default true */
  sourceMap?: boolean;
  /**
   * Predicate for native custom elements; matching tags emit as plain
   * HTML instead of resolved components. Mirrors Vue's `isCustomElement`.
   */
  isCustomElement?: (tag: string) => boolean;
  /**
   * Tag to entry for components the SFC doesn't import statically (Nuxt
   * auto-imports, globals): a path string or `{ path, export? }`. Accepts
   * a static map/object or a getter re-evaluated per transform.
   */
  additionalImports?:
    | Record<string, AdditionalImportInput>
    | Map<string, AdditionalImportInput>
    | (() => Record<string, AdditionalImportInput> | Map<string, AdditionalImportInput>);
  /**
   * Optional optimization: maps a root-relative source path
   * (`/components/Counter.vue`) to the public chunk URL to bake into the
   * AST (`/_nuxt/Counter-XXX.js`). Re-evaluated per transform. Returning
   * `undefined` is normal and keeps the source path, which hosts resolve
   * at runtime via the manifest's `import.meta.glob` or a custom `importFn`.
   */
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
}

/**
 * Vite plugin adding onigiri serialization to Vue SFCs: dev attaches a
 * virtual `__onigiriRender` module to the default export, build injects
 * the render into `setup()` so it captures the setup-script closure.
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
    // Runs after plugin-vue but before vite:import-analysis; hook-level
    // `order: 'post'` would leave `virtual:onigiri:*` unrewritten in the browser.
    enforce: "post",

    config(userConfig, env) {
      return {
        optimizeDeps: {
          exclude: ["vue-onigiri"],
        },
        define:
          userConfig.define?.__DEV__ === undefined
            ? { __DEV__: JSON.stringify(env.mode !== "production") }
            : undefined,
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
          // Root-relative additionalImports paths resolve against the Vite
          // root; skip Windows-absolute (`/D:/...`) and `/@...` internal forms.
          if (
            id.startsWith("/")
            && !id.startsWith("//")
            && !id.startsWith("/@")
            && !/^\/[A-Za-z]:/.test(id)
          ) {
            const rootJoined = config.root.replace(/[/\\]+$/, "") + id;
            const abs = existsSync(rootJoined) || !existsSync(id) ? rootJoined : id;
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
          resolveImport: async (source, importer) =>
            (await this.resolve(source, importer, { skipSelf: true }))?.id,
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

        // Bare `.vue`: inject the setup bridge first when an inline render is
        // present (build closures are otherwise dark), then attach render + descriptor.
        if (!query) {
          if (!code.includes("export default")) return null;
          const onigiriImport = `${ONIGIRI_PREFIX}${encodeURIComponent(filePath)}${ONIGIRI_SUFFIX}`;
          const sourcePath = toRootRelative(filePath, config.root);
          const descriptorChunk = resolveChunkUrl?.(sourcePath) ?? sourcePath;

          let workCode = code;
          if (hasInlineTemplate(code)) {
            const injected = await injectIntoSetupAsync(
              code,
              filePath,
              sourceMap,
              config,
              isCustomElement,
              resolveAdditionalImports(),
              resolveChunkUrl,
              registerOnigiriTarget,
              async (source, importer) =>
                (await this.resolve(source, importer, { skipSelf: true }))?.id,
            );
            if (injected) workCode = injected.code;
          }
          return attachAsProperty(workCode, onigiriImport, sourceMap, descriptorChunk);
        }

        // Build mode: the SSR render closes over setup bindings an external
        // render can't reach, so inject ours inside setup to share the closure.
        if (query.includes("type=script")) {
          if (hasInlineTemplate(code)) {
            return injectIntoSetupAsync(
              code,
              filePath,
              sourceMap,
              config,
              isCustomElement,
              resolveAdditionalImports(),
              resolveChunkUrl,
              registerOnigiriTarget,
              async (source, importer) =>
                (await this.resolve(source, importer, { skipSelf: true }))?.id,
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
