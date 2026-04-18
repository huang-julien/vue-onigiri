import type { DefineComponent, Directive } from 'vue'

export type ImportFn = (src: string, exportName?: string) => Promise<DefineComponent>

/**
 * Module-scoped override for the chunk-loading function. Only non-Vite
 * consumers (custom bundlers, non-standard SSR entrypoints) need to set
 * this. In a normal Vite / Nuxt setup the runtime loader resolves chunks
 * through `virtual:onigiri/manifest`, which the plugin emits automatically.
 */
let installedImportFn: ImportFn | undefined

export function setOnigiriImportFn(fn: ImportFn | undefined): void {
  installedImportFn = fn
}

/** @internal — used by the loader. */
export function _getInstalledImportFn(): ImportFn | undefined {
  return installedImportFn
}

export const loadClientDirective: Directive = {
  getSSRProps(binding, vnode) {
    if (binding.value !== false) {
      // @ts-ignore
      vnode._onigiriLoadClient = true
    }
    return {}
  },
  created(_, binding, vnode) {
    if (binding.value !== false) {
      // @ts-ignore
      vnode._onigiriLoadClient = true
    }
    return binding
  },
}
