import type { App, InjectionKey } from "vue";
import type { ImportFn } from "./utils";

export const ONIGIRI_IMPORT_FN: InjectionKey<ImportFn> = Symbol.for("vue-onigiri:import-fn");

export interface OnigiriPluginOptions {
  importFn?: ImportFn;
}

export const onigiriPlugin = {
  install(app: App, options?: OnigiriPluginOptions) {
    if (options?.importFn) {
      app.provide(ONIGIRI_IMPORT_FN, options.importFn);
    }
  },
};
