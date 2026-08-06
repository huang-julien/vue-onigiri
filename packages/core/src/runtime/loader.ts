import {
  h,
  defineComponent,
  ErrorCodes,
  getCurrentInstance,
  handleError,
  inject,
  shallowRef,
  watch,
  type FunctionalComponent,
  type PropType,
} from "vue";
import type { VServerComponent, VServerComponentComponent } from "./shared";
import { renderChildren } from "./deserialize";
import type { ImportFn } from "./utils";
import { importFn as defaultImportFn } from "./manifest-default";
import { ONIGIRI_IMPORT_FN } from "./plugin";

const LOAD_FAILED: FunctionalComponent = () => null;

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
    // inject()/getCurrentInstance() must run before the first await of an async setup.
    const instance = getCurrentInstance();
    const appImportFn = inject(ONIGIRI_IMPORT_FN, undefined);
    const resolveImportFn = (): ImportFn => props.importFn ?? appImportFn ?? defaultImportFn;

    const loadComponent = async (chunk: string, exportName: string) => {
      try {
        return await resolveImportFn()(chunk, exportName);
      } catch (error) {
        handleError(error, instance, ErrorCodes.ASYNC_COMPONENT_LOADER, false);
        return LOAD_FAILED;
      }
    };

    const Loaded = shallowRef(await loadComponent(props.data[2], props.data[3] ?? "default"));

    let loadId = 0;
    watch(
      [() => props.data[2], () => props.data[3]],
      async ([chunk, exportName]) => {
        const id = ++loadId;
        const component = await loadComponent(chunk, exportName ?? "default");
        if (id === loadId) Loaded.value = component;
      },
    );

    const buildSlots = () =>
      Object.fromEntries(
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

    return () => h(Loaded.value, props.data[1], buildSlots());
  },
});
