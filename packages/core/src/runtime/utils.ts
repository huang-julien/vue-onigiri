import type { App, DefineComponent, Directive, InjectionKey } from "vue";

export type ImportFn = (src: string, exportName?: string) => Promise<DefineComponent>;

export const ONIGIRI_IMPORT_FN_KEY: InjectionKey<ImportFn> = Symbol("onigiri-importFn");

/**
 * Attach an app-scoped resolver for `v-load-client` chunks. The function
 * receives the root-relative source path the chunk plugin tagged the
 * component with (`/components/Foo.vue`) and the export name; it returns
 * the resolved component. Use this instead of the built-in manifest when
 * you need full control over how chunk paths map to modules — handy when
 * dev and build emit different module identities (CDN-served bundles,
 * federation, custom path normalization, etc.).
 *
 * Resolution wins over the built-in manifest and the module-scoped
 * `setOnigiriImportFn`, but is scoped to the app you call it on, so it
 * doesn't bleed across concurrent SSR requests.
 */
export function provideOnigiriImportFn(app: App, fn: ImportFn): void {
  app.provide(ONIGIRI_IMPORT_FN_KEY, fn);
}

/**
 * Module-scoped override for the chunk-loading function. Only non-Vite
 * consumers (custom bundlers, non-standard SSR entrypoints) need to set
 * this. Prefer `provideOnigiriImportFn` for app-scoped overrides.
 */
let installedImportFn: ImportFn | undefined;

export function setOnigiriImportFn(fn: ImportFn | undefined): void {
  installedImportFn = fn;
}

/** @internal — used by the loader. */
export function _getInstalledImportFn(): ImportFn | undefined {
  return installedImportFn;
}

export const loadClientDirective: Directive = {
  getSSRProps(binding, vnode) {
    if (binding.value !== false) {
      // @ts-ignore
      vnode._onigiriLoadClient = true;
    }
    return {};
  },
  created(_, binding, vnode) {
    if (binding.value !== false) {
      // @ts-ignore
      vnode._onigiriLoadClient = true;
    }
    return binding;
  },
};
