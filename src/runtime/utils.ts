import type { DefineComponent, Directive } from 'vue'
export type ImportFn = (src: string, exportName?: string) => Promise<DefineComponent>

/**
 * Default import function: dynamically imports the module at `src` and
 * returns the named export (or the default). Works on the client for both
 * dev (source paths resolved by Vite) and prod (built chunk URLs).
 *
 * For SSR prod (URLs can't be imported on the server), or for environments
 * where bundlers need a static manifest, use `createImportFn(manifest)` or
 * pass a custom `importFn` to `renderOnigiri`.
 */
export const defaultImportFn: ImportFn = async (src, exportName = 'default') => {
  const mod: any = await import(/* @vite-ignore */ src)
  return (mod[exportName] ?? mod.default ?? mod) as DefineComponent
}

/**
 * Build an `ImportFn` from a static manifest (e.g. emitted by a bundler).
 * The manifest maps a chunk key to a loader function.
 */
export function createImportFn(
  manifest: Record<string, () => Promise<unknown>>,
): ImportFn {
  return async (src, exportName = 'default') => {
    const loader = manifest[src]
    if (!loader) {
      throw new Error(`[vue-onigiri] No loader for chunk "${src}". Known chunks: ${Object.keys(manifest).join(', ')}`)
    }
    const mod: any = await loader()
    return (mod[exportName] ?? mod.default ?? mod) as DefineComponent
  }
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
