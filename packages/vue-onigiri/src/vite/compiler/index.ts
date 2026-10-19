import type { Logger, Plugin } from "vite";
import type { CompilerOptions } from "@vue/compiler-dom";
import { attachDescriptor } from "./attach-descriptor";
import { toPackageSpecifier, toRootRelative } from "./paths";
import { ssrLoadClientTransform } from "./ssr-load-client";

export type { AdditionalImport, AdditionalImportInput, AdditionalImportsOption } from "./options";

export interface OnigiriCompilerOptions {
  /**
   * Emits a source map for the descriptor attachment.
   *
   * @default true
   */
  sourceMap?: boolean;
  /**
   * Bakes a public chunk URL into the descriptor in place of the
   * root-relative source path of an SFC.
   *
   * @remarks Returning `undefined` keeps the source path for runtime resolution.
   */
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
}

/**
 * The slice of `@vitejs/plugin-vue`'s `api.options` the transform injection touches.
 */
interface VuePluginApi {
  options: { template?: { compilerOptions?: CompilerOptions } };
}

const VUE_PLUGIN_NAME = "vite:vue";

/**
 * Vite plugin wiring Vue's compiler for islands: injects `ssrLoadClientTransform`
 * into every `@vitejs/plugin-vue` instance and attaches the `{ chunk, export }`
 * descriptor `ssrRenderClientComponent` reads to each SFC's default export in server builds.
 */
export function onigiriCompilerPlugin(options: OnigiriCompilerOptions = {}): Plugin {
  const { sourceMap = true, resolveChunkUrl } = options;
  let root = process.cwd();

  return {
    name: "vite:vue-onigiri-compiler",
    // Runs after plugin-vue, so the default export it attaches to already exists.
    enforce: "post",

    config() {
      // Prebundling would bypass the manifest plugin's resolveId swap of `vue-onigiri/manifest`.
      return { optimizeDeps: { exclude: ["vue-onigiri"] } };
    },

    configResolved(config) {
      root = config.root;
      injectSsrTransform(config.plugins, config.logger);
    },

    transform(code, id, opts) {
      // Only the server reads the descriptor, so client bundles never carry it.
      const consumer = this?.environment?.config.consumer;
      if (consumer ? consumer === "client" : opts?.ssr === false) return null;
      if (id.includes("?") || !id.endsWith(".vue") || !code.includes("export default")) return null;
      const chunk = descriptorChunk(id, root, resolveChunkUrl);
      return chunk ? attachDescriptor(code, chunk, sourceMap) : null;
    },
  };
}

/**
 * Push the transform into each plugin-vue instance's template compiler options, once.
 */
function injectSsrTransform(plugins: readonly Plugin[], logger: Logger): void {
  let found = false;
  for (const plugin of plugins) {
    const api =
      plugin.name === VUE_PLUGIN_NAME ? (plugin.api as VuePluginApi | undefined) : undefined;
    if (!api?.options) continue;
    found = true;
    const { options } = api;
    const compilerOptions = options.template?.compilerOptions;
    const nodeTransforms = compilerOptions?.nodeTransforms ?? [];
    if (nodeTransforms.includes(ssrLoadClientTransform)) continue;
    // plugin-vue reads its options through this setter's ref, and spreads them again in its own configResolved.
    api.options = {
      ...options,
      template: {
        ...options.template,
        compilerOptions: {
          ...compilerOptions,
          nodeTransforms: [...nodeTransforms, ssrLoadClientTransform],
        },
      },
    };
  }
  if (!found) {
    logger.warn(
      "[vue-onigiri] @vitejs/plugin-vue was not found; add `ssrLoadClientTransform` to the Vue " +
        "compiler's `nodeTransforms` by hand or `v-load-client` writes no markers.",
    );
  }
}

/**
 * Root-relative source path (or its baked URL) for app files, package specifier for package files.
 */
function descriptorChunk(
  filePath: string,
  root: string,
  resolveChunkUrl: OnigiriCompilerOptions["resolveChunkUrl"],
): string | undefined {
  const sourcePath = toRootRelative(filePath, root);
  const inRoot = sourcePath !== filePath.replaceAll("\\", "/");
  if (inRoot && !sourcePath.startsWith("/node_modules/")) {
    return resolveChunkUrl?.(sourcePath) ?? sourcePath;
  }
  return toPackageSpecifier(filePath);
}
