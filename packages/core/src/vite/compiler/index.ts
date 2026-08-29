import { existsSync } from "node:fs";
import type { Plugin, ResolvedConfig } from "vite";
import type { OnigiriCompileOptions } from "./analyze-sfc";
import { ONIGIRI_PREFIX, ONIGIRI_SUFFIX } from "./constants";
import { loadVirtualOnigiriModule } from "./load-virtual";
import { injectIntoSetupAsync } from "./inject-setup";
import { attachAsProperty } from "./attach-property";
import {
  type AdditionalImportInput,
  type AdditionalImportsOption,
  makeResolveImport,
  resolveAdditionalImports,
} from "./options";
import {
  type SourceCaptureApi,
  findSourceCaptureApi,
  runWithCapturedSources,
} from "./source-capture";
import { registerOnigiriTarget } from "../shared";
import { toRootRelative } from "./paths";
import type { ComponentIdGenerator } from "./scope-id";

export type { AdditionalImportInput };
export type { ComponentIdGenerator };

/**
 * Detect whether plugin-vue's output already inlines a render function
 * (client or SSR shape); both need the setup-bridge injection so the
 * onigiri render closes over setup-script bindings.
 */
function hasInlineTemplate(code: string): boolean {
  return (
    // Client render-fn codegen
    code.includes("_createElementVNode") ||
    code.includes("_createVNode") ||
    code.includes("_createBlock") ||
    code.includes("_createElementBlock") ||
    code.includes("ssrInterpolate") ||
    code.includes("ssrRenderAttrs") ||
    // SSR render-fn codegen (production build, ?vue&type=template SSR sub-module)
    code.includes("_push(`<") ||
    code.includes("_push(ssr") ||
    code.includes("ssrRenderComponent") ||
    code.includes("ssrRenderSlot") ||
    code.includes("ssrRenderList") ||
    code.includes("ssrRenderClass") ||
    code.includes("ssrRenderStyle") ||
    code.includes("ssrRenderVNode")
  );
}

export interface OnigiriCompilerOptions {
  /**
   * Emits a source map for the generated render function.
   *
   * @default true
   */
  sourceMap?: boolean;
  /**
   * Pins the mode used for scope-id derivation, like plugin-vue's
   * `isProduction`. Must match the value plugin-vue uses, otherwise scope
   * ids diverge and scoped styles break.
   *
   * @default the resolved Vite config's `isProduction`
   */
  isProduction?: boolean;
  /**
   * Customizes the scope-id hash, like plugin-vue's
   * `features.componentIdGenerator`. Must match the value plugin-vue uses.
   *
   * @default 'filepath' in development, 'filepath-source' in production
   */
  componentIdGenerator?: ComponentIdGenerator;
  /**
   * Decides whether a tag is a native custom element and should be emitted
   * as plain HTML instead of being resolved as a component, like Vue's
   * `isCustomElement`.
   */
  isCustomElement?: (tag: string) => boolean;
  /**
   * Registers components the SFC doesn't import statically, so
   * `v-load-client` can resolve them (Nuxt auto-imports, globals). A getter
   * is re-evaluated on every transform.
   */
  additionalImports?: AdditionalImportsOption;
  /**
   * Bakes a public chunk URL into the AST in place of the root-relative
   * source path of a `v-load-client` target.
   *
   * @remarks Returning `undefined` keeps the source path for runtime resolution.
   */
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
}

/**
 * Vite plugin adding onigiri serialization to Vue SFCs: dev attaches a
 * virtual `__onigiriRender` module to the default export, build injects
 * the render into `setup()` so it captures the setup-script closure.
 */
export function onigiriCompilerPlugin(options: OnigiriCompilerOptions = {}): Plugin {
  const {
    sourceMap = true,
    isProduction,
    componentIdGenerator,
    isCustomElement,
    additionalImports,
    resolveChunkUrl,
  } = options;
  let config: ResolvedConfig;
  let captureApi: SourceCaptureApi | undefined;

  const withCapturedSources = <T>(environment: string | undefined, fn: () => T): T => {
    const api = captureApi;
    return api
      ? runWithCapturedSources((filePath) => api.getCapturedSource(filePath, environment), fn)
      : fn();
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
      captureApi = findSourceCaptureApi(resolvedConfig.plugins);
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
            id.startsWith("/") &&
            !id.startsWith("//") &&
            !id.startsWith("/@") &&
            !/^\/[A-Za-z]:/.test(id)
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
      return withCapturedSources(this.environment?.name, () =>
        loadVirtualOnigiriModule(
          id,
          {
            config,
            sourceMap,
            isProduction,
            componentIdGenerator,
            isCustomElement,
            additionalImports: resolveAdditionalImports(additionalImports),
            resolveChunkUrl,
            registerTarget: registerOnigiriTarget,
            resolveImport: makeResolveImport(this),
          },
          (msg) => this.error(msg),
        ),
      );
    },

    transform: {
      async handler(code, id) {
        const [filePath, query] = id.split("?");
        if (!filePath || !filePath.endsWith(".vue") || filePath.startsWith(ONIGIRI_PREFIX)) {
          return null;
        }

        // Built on demand: `additionalImports` may be a getter re-evaluated
        // per transform, so it stays unread unless an injection happens.
        const injectOptions = (): OnigiriCompileOptions => ({
          config,
          sourceMap,
          isProduction,
          componentIdGenerator,
          isCustomElement,
          additionalImports: resolveAdditionalImports(additionalImports),
          resolveChunkUrl,
          registerTarget: registerOnigiriTarget,
          resolveImport: makeResolveImport(this),
        });

        // Bare `.vue`: inject the setup bridge first when an inline render is
        // present (build closures are otherwise dark), then attach render + descriptor.
        if (!query) {
          if (!code.includes("export default")) return null;
          const onigiriImport = `${ONIGIRI_PREFIX}${encodeURIComponent(filePath)}${ONIGIRI_SUFFIX}`;
          const sourcePath = toRootRelative(filePath, config.root);

          const addressable =
            sourcePath.startsWith("/") && !sourcePath.startsWith("/node_modules/");
          const descriptorChunk = addressable
            ? (resolveChunkUrl?.(sourcePath) ?? sourcePath)
            : undefined;

          let workCode = code;
          if (hasInlineTemplate(code)) {
            const injected = await withCapturedSources(this.environment?.name, () =>
              injectIntoSetupAsync(code, filePath, injectOptions()),
            );
            if (injected) workCode = injected.code;
          }
          return attachAsProperty(workCode, onigiriImport, sourceMap, descriptorChunk);
        }

        // Build mode: the SSR render closes over setup bindings an external
        // render can't reach, so inject ours inside setup to share the closure.
        if (query.includes("type=script")) {
          if (hasInlineTemplate(code)) {
            return withCapturedSources(this.environment?.name, () =>
              injectIntoSetupAsync(code, filePath, injectOptions()),
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
