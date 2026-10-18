import type { Plugin } from "vite";
import { type OnigiriCompilerOptions, onigiriCompilerPlugin } from "./compiler";
import { type OnigiriManifestPluginOptions, onigiriManifestPlugin } from "./manifest";
import type { OnigiriScanOptions } from "./scan";
import { type OnigiriScanResolveOptions, onigiriScanPlugin } from "./scan-plugin";
import { createOnigiriRegistry } from "./shared";

export interface OnigiriPluginsOptions
  extends
    OnigiriCompilerOptions,
    Omit<OnigiriManifestPluginOptions, "registry">,
    OnigiriScanResolveOptions {
  /**
   * Scans SFC templates for `v-load-client` targets at `buildStart`, so the
   * manifest's `"auto"` includes are complete before any environment builds.
   *
   * @default true
   */
  scan?: boolean | OnigiriScanOptions;
}

/**
 * Recommended entry point wiring every onigiri plugin in working order:
 * scan (pre), compiler (post), manifest, sharing one target registry.
 * The individual plugins stay exported for hosts that need custom placement.
 */
export function onigiriPlugins(options: OnigiriPluginsOptions = {}): Plugin[] {
  const {
    sourceMap,
    resolveChunkUrl,
    isCustomElement,
    additionalImports,
    scan = true,
    serverInclude,
    clientInclude,
    extraEntries,
    stub,
  } = options;
  const registry = createOnigiriRegistry();

  const plugins: Plugin[] = [];
  if (scan !== false) {
    plugins.push(
      onigiriScanPlugin({
        ...(scan === true ? {} : scan),
        isCustomElement,
        additionalImports,
        registry,
      }),
    );
  }
  plugins.push(
    onigiriCompilerPlugin({ sourceMap, resolveChunkUrl }),
    onigiriManifestPlugin({ serverInclude, clientInclude, extraEntries, stub, registry }),
  );
  return plugins;
}
