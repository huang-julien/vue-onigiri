import type { App, InjectionKey } from "vue";
import type { ImportFn } from "./utils";

export const ONIGIRI_IMPORT_FN: InjectionKey<ImportFn> =
  /* #__PURE__ */ Symbol.for("vue-onigiri:import-fn");

/**
 * Options of `onigiriPlugin`, the app-level fallback for every loader.
 */
export interface OnigiriPluginOptions {
  /**
   * Resolves client components for every island of the app that passes no `importFn` of its own.
   */
  importFn?: ImportFn;
}

export const onigiriPlugin = {
  install(app: App, options?: OnigiriPluginOptions) {
    if (options?.importFn) {
      app.provide(ONIGIRI_IMPORT_FN, options.importFn);
    }
  },
};
