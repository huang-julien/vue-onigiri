import { h, type DefineComponent, defineComponent, inject } from "vue";
import type { VServerComponent } from "./shared";
import { renderChildren } from "./deserialize";
import { INJECTION_KEY } from "./plugin";
import { defaultImportFn } from "./utils";

export default defineComponent({
  name: "vue-onigiri:component-loader",
  props: ["data", "importFn"],
  async setup(props) {
    const componentMap = inject(
      INJECTION_KEY,
      new Map<string, DefineComponent>(),
    );
    const importFn = props.importFn || defaultImportFn;
    const hasComponent = componentMap.has(props.data[2]);
    if (!hasComponent) {
      const component = await importFn(props.data[2]);
      componentMap.set(props.data[2], component);
    }
    return () => {
      const component = componentMap.get(props.data[2]);
      const slots = Object.fromEntries(
        Object.entries(props.data[3] || {}).map(([key, value]) => {
          return [
            key,
            () =>
              renderChildren(value as VServerComponent[] | undefined, importFn),
          ];
        }),
      );
      if (component) {
        return h(component, props.data[1], slots);
      }
    };
  },
});
