import { h, defineAsyncComponent, defineComponent } from 'vue'
import type { VServerComponent, VServerComponentComponent } from './shared'
import { renderChildren } from './deserialize'
import { _getInstalledImportFn, type ImportFn } from './utils'
// Provided by `onigiriManifestPlugin`. Consumers must register that plugin
// in their Vite / Nuxt config. A custom runtime (no Vite) can override the
// resolver at boot with `setOnigiriImportFn(fn)`.
import { importFn as manifestImportFn } from 'virtual:onigiri/manifest'

function resolveImportFn(): ImportFn {
  return _getInstalledImportFn() ?? manifestImportFn
}

/**
 * Component loader — one per Component marker in the AST.
 *
 * Uses `defineAsyncComponent` to wrap the dynamic import. This is what Vue
 * expects for SSR hydration of async-loaded components: the server awaits
 * the loader and renders the resolved component; the client creates a
 * matching async component wrapper that hydrates against the server HTML
 * once the import resolves. A plain `async setup()` on this loader would
 * cause hydration mismatches outside of a Suspense boundary.
 */
export default defineComponent({
  name: 'vue-onigiri:component-loader',
  props: {
    data: {
      type: Object as () => VServerComponentComponent,
      required: true,
    },
  },
  setup(props) {
    const chunkPath = props.data[2]
    const exportName = props.data[3] ?? 'default'

    const AsyncInner = defineAsyncComponent(async () => {
      const importFn = resolveImportFn()
      return await importFn(chunkPath, exportName)
    })

    return () => {
      const slots = Object.fromEntries(
        Object.entries(props.data[4] || {}).map(([key, value]) => {
          return [
            key,
            () => {
              if (!value) return undefined
              const asArr = Array.isArray(value) && typeof value[0] === 'number'
                ? [value as unknown as VServerComponent]
                : (value as VServerComponent[])
              return renderChildren(asArr)
            },
          ]
        }),
      )
      return h(AsyncInner, props.data[1], slots)
    }
  },
})
