import type { Plugin, ResolvedConfig } from "vite";
import {
  type AdditionalImportsOption,
  makeResolveImport,
  resolveAdditionalImports,
} from "./compiler/options";
import { normaliseAdditionalImports } from "./compiler/load-virtual";
import { type OnigiriScanOptions, scanClientTargets } from "./scan";
import { registerOnigiriTarget } from "./shared";

export interface OnigiriScanPluginOptions extends OnigiriScanOptions {
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
}

/**
 * `buildStart` pre-pass scanning SFC templates for `v-load-client` targets,
 * so the manifest's `"auto"` includes are complete before any environment
 * builds.
 */
export function onigiriScanPlugin(options: OnigiriScanPluginOptions = {}): Plugin {
  const { include, exclude, isCustomElement, additionalImports } = options;
  let config: ResolvedConfig;
  // Memoized so multi-environment builds (client + ssr) scan only once.
  let scanPromise: Promise<void> | undefined;

  return {
    name: "vite:vue-onigiri-scan",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async buildStart() {
      scanPromise ??= scanClientTargets({
        include,
        exclude,
        root: config.root,
        additionalImports:
          normaliseAdditionalImports(resolveAdditionalImports(additionalImports), config.root) ??
          new Map(),
        isCustomElement,
        resolveImport: makeResolveImport(this),
        registerTarget: registerOnigiriTarget,
        warn: (msg) => this.warn(msg),
      });
      await scanPromise;
    },
  };
}
