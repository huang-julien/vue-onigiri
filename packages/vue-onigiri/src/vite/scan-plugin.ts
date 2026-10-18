import type { Plugin, ResolvedConfig } from "vite";
import {
  type AdditionalImportsOption,
  makeResolveImport,
  resolveAdditionalImports,
} from "./compiler/options";
import { type OnigiriScanOptions, scanClientTargets, scanSfcSource } from "./scan";
import { type OnigiriRegistryOption, sharedOnigiriRegistry } from "./shared";

/**
 * How the scan resolves a `v-load-client` tag to the file it registers.
 */
export interface OnigiriScanResolveOptions {
  /**
   * Decides whether a tag is a native custom element and should be emitted
   * as plain HTML instead of being resolved as a component, like Vue's
   * `isCustomElement`.
   */
  isCustomElement?: (tag: string) => boolean;
  /**
   * Registers components the SFC doesn't import statically, so
   * `v-load-client` can resolve them (Nuxt auto-imports, globals). A getter
   * is re-evaluated on every scan.
   */
  additionalImports?: AdditionalImportsOption;
}

export interface OnigiriScanPluginOptions
  extends OnigiriScanOptions, OnigiriScanResolveOptions, OnigiriRegistryOption {}

/**
 * `buildStart` pre-pass scanning SFC templates for `v-load-client` targets,
 * so the manifest's `"auto"` includes are complete before any environment
 * builds. In dev, each transformed SFC is scanned again to pick up new targets.
 */
export function onigiriScanPlugin(options: OnigiriScanPluginOptions = {}): Plugin {
  const {
    include,
    exclude,
    isCustomElement,
    additionalImports,
    registry = sharedOnigiriRegistry,
  } = options;
  let config: ResolvedConfig;
  // Memoized so multi-environment builds (client + ssr) scan only once.
  let scanPromise: Promise<void> | undefined;
  // Dev scans a file again on transform; its warnings already surfaced at buildStart.
  const warned = new Set<string>();
  const warnOnce = (warn: (msg: string) => void) => (msg: string) => {
    if (warned.has(msg)) return;
    warned.add(msg);
    warn(msg);
  };

  return {
    name: "vite:vue-onigiri-scan",
    // Sees the raw SFC source before plugin-vue compiles it.
    enforce: "pre",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async buildStart() {
      scanPromise ??= scanClientTargets({
        include,
        exclude,
        root: config.root,
        additionalImports: resolveAdditionalImports(additionalImports, config.root),
        isCustomElement,
        resolveImport: makeResolveImport(this),
        registerTarget: registry.register,
        warn: warnOnce((msg) => this.warn(msg)),
      });
      await scanPromise;
    },
    async transform(code, id) {
      if (config.command !== "serve" || id.includes("?") || !id.endsWith(".vue")) return;
      await scanSfcSource(code, id, {
        root: config.root,
        additionalImports: resolveAdditionalImports(additionalImports, config.root),
        isCustomElement,
        resolveImport: makeResolveImport(this),
        registerTarget: registry.register,
        warn: warnOnce((msg) => this.warn(msg)),
      });
    },
  };
}
