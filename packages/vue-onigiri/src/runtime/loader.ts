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
  type VNode,
} from "vue";
import type { OnigiriComponentMarker } from "../shared/markers";
import { htmlToVNodes } from "./dom-to-vnode";
import { importFn as defaultImportFn } from "vue-onigiri/manifest";
import { ONIGIRI_IMPORT_FN } from "./plugin";
import type { ImportFn } from "./utils";

const LOAD_FAILED: FunctionalComponent = () => null;

export default defineComponent({
  name: "vue-onigiri:component-loader",
  props: {
    data: {
      type: Array as unknown as PropType<OnigiriComponentMarker>,
      required: true,
    },
    importFn: {
      type: Function as PropType<ImportFn>,
      required: false,
      default: undefined,
    },
    nonce: {
      type: String,
      required: true,
    },
  },

  async setup(props) {
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
    watch([() => props.data[2], () => props.data[3]], async ([chunk, exportName]) => {
      const id = ++loadId;
      const component = await loadComponent(chunk, exportName ?? "default");
      if (id === loadId) Loaded.value = component;
    });

    // Same VNodes across renders keep hydrated static DOM; a new slot string gets a fresh parse.
    const htmlSlots = new Map<string, VNode[]>();
    const renderHtmlSlot = (html: string): VNode[] => {
      let vnodes = htmlSlots.get(html);
      if (!vnodes) {
        vnodes = htmlToVNodes(html, { importFn: resolveImportFn(), nonce: props.nonce });
        htmlSlots.set(html, vnodes);
      }
      return vnodes;
    };

    const buildSlots = () =>
      Object.fromEntries(
        Object.entries(props.data[4] ?? {}).map(([name, html]) => [
          name,
          () => renderHtmlSlot(html),
        ]),
      );

    return () => h(Loaded.value, props.data[1], buildSlots());
  },
});
