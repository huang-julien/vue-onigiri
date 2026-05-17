import { h, defineComponent, type PropType } from "vue";
import type { VServerComponent, VServerComponentComponent } from "./shared";
import { renderChildren } from "./deserialize";
import type { ImportFn } from "./utils";
import { importFn as manifestImportFn } from "virtual:onigiri/manifest";

export default defineComponent({
  name: "vue-onigiri:component-loader",
  props: {
    data: {
      type: Object as () => VServerComponentComponent,
      required: true,
    },
    /**
     * Threaded from `renderOnigiri(ast, { importFn })`. When absent we
     * fall back to the importFn baked into `virtual:onigiri/manifest`
     * (Vite's `import.meta.glob` for in-bundle modules, dynamic
     * `import(url)` for absolute chunk URLs).
     */
    importFn: {
      type: Function as PropType<ImportFn>,
      required: false,
      default: undefined,
    },
  },

  async setup(props) {
    const importFn = props.importFn ?? manifestImportFn;
    const Loaded = await importFn(props.data[2], props.data[3] ?? "default");

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
            return renderChildren(asArr, { importFn: props.importFn });
          },
        ];
      }),
    );

    return () => h(Loaded, props.data[1], slots);
  },
});
