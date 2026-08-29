import type { Plugin } from "vite";
import { type OnigiriCompilerOptions, onigiriCompilerPlugin } from "./compiler";
import { onigiriSourceCapturePlugin } from "./compiler/source-capture";
import { type OnigiriManifestPluginOptions, onigiriManifestPlugin } from "./manifest";
import type { OnigiriScanOptions } from "./scan";
import { onigiriScanPlugin } from "./scan-plugin";

export interface OnigiriPluginsOptions
  extends OnigiriCompilerOptions, OnigiriManifestPluginOptions {
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
 * source capture (pre), scan, compiler (post), manifest. The individual
 * plugins stay exported for hosts that need custom placement.
 */
export function onigiriPlugins(options: OnigiriPluginsOptions = {}): Plugin[] {
  const {
    sourceMap,
    isProduction,
    componentIdGenerator,
    isCustomElement,
    additionalImports,
    resolveChunkUrl,
    scan = true,
    serverInclude,
    clientInclude,
    extraEntries,
    stub,
  } = options;

  const plugins: Plugin[] = [onigiriSourceCapturePlugin()];
  if (scan !== false) {
    plugins.push(
      onigiriScanPlugin({ ...(scan === true ? {} : scan), isCustomElement, additionalImports }),
    );
  }
  plugins.push(
    onigiriCompilerPlugin({
      sourceMap,
      isProduction,
      componentIdGenerator,
      isCustomElement,
      additionalImports,
      resolveChunkUrl,
    }),
    onigiriManifestPlugin({ serverInclude, clientInclude, extraEntries, stub }),
  );
  return plugins;
}
