declare module 'virtual:vsc:*' {
  import type { Component } from 'vue'
  const component: Component
  export default component
}

declare module 'virtual:onigiri/manifest' {
  import type { ImportFn } from 'vue-onigiri/runtime/utils'
  /** Raw glob map: source path → lazy-loaded module. */
  export const manifest: Record<string, () => Promise<unknown>>
  /**
   * Resolver consumed by the onigiri runtime loader. Accepts a source
   * path as registered in `manifest` and returns the component export.
   */
  export const importFn: ImportFn
}

/**
 * Vue's compile-time dev flag.
 */
declare const __DEV__: boolean
