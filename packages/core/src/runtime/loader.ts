import { h, defineAsyncComponent, defineComponent, inject, Suspense } from "vue";
import type { VServerComponent, VServerComponentComponent } from "./shared";
import { renderChildren } from "./deserialize";
import { _getInstalledImportFn, ONIGIRI_IMPORT_FN_KEY, type ImportFn } from "./utils";
import { importFn as manifestImportFn } from "virtual:onigiri/manifest";

/**
 * Resolution order:
 *   1. App-scoped `importFn` (`provideOnigiriImportFn`)
 *   2. Module-scoped `importFn` (`setOnigiriImportFn`)
 *   3. Built-in manifest from `virtual:onigiri/manifest`
 *
 * Must be called synchronously inside `setup()` because of `inject()`.
 */
function resolveImportFn(): ImportFn {
  const injectedFn = inject(ONIGIRI_IMPORT_FN_KEY, null);
  if (injectedFn) return injectedFn;
  return _getInstalledImportFn() ?? manifestImportFn;
}

export default defineComponent({
  name: "vue-onigiri:component-loader",
  props: {
    data: {
      type: Object as () => VServerComponentComponent,
      required: true,
    },
  },
  setup(props) {
    // Resolve once at setup time so `inject()` runs in the right context.
    const importFn = resolveImportFn();
    const AsyncInner = defineAsyncComponent(async () => {
      return await importFn(props.data[2], props.data[3] ?? "default");
    });

    return () => {
      const slots = Object.fromEntries(
        Object.entries(props.data[4] || {}).map(([key, value]) => {
          return [
            key,
            () => {
              if (!value) return undefined;
              const asArr =
                Array.isArray(value) && typeof value[0] === "number"
                  ? [value as unknown as VServerComponent]
                  : (value as VServerComponent[]);
              return renderChildren(asArr);
            },
          ];
        }),
      );

      return h(Suspense, null, {
        default: () => h(AsyncInner, props.data[1], slots),
        fallback: () => h("div"),
      });
    };
  },
});
