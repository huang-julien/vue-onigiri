import { h, defineComponent, inject, type PropType } from "vue";
import type { VServerComponent, VServerComponentComponent } from "./shared";
import { renderChildren } from "./deserialize";
import type { ImportFn } from "./utils";
import { importFn as defaultImportFn } from "./manifest-default";
import { ONIGIRI_IMPORT_FN } from "./plugin";

export default defineComponent({
  name: "vue-onigiri:component-loader",
  props: {
    data: {
      type: Object as () => VServerComponentComponent,
      required: true,
    },
    importFn: {
      type: Function as PropType<ImportFn>,
      required: false,
      default: undefined,
    },
  },

  async setup(props) {
    // inject() must run before the first await of an async setup.
    const appImportFn = inject(ONIGIRI_IMPORT_FN, undefined);
    const importFn = props.importFn ?? appImportFn ?? defaultImportFn;
    const Loaded = await importFn(props.data[2], props.data[3] ?? "default");

    const slots = Object.fromEntries(
      Object.entries(props.data[4] || {}).map(([key, value]) => {
        return [
          key,
          () => {
            if (!value) return undefined;
            const asArr
              = Array.isArray(value) && typeof value[0] === "number"
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
