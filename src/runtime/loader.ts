import { h, type DefineComponent, defineComponent, inject } from "vue";
import type { VServerComponent, VServerComponentComponent } from "./shared";
import { renderChildren } from "./deserialize";
import { INJECTION_KEY } from "./plugin";
import { defaultImportFn } from "./utils";

export default defineComponent({
  name: "vue-bento:component-loader",
  props: ["data", "importFn"],
  async setup(props) {
    const componentMap = inject(
      INJECTION_KEY,
      new Map<string, DefineComponent>(),
    );
    const importFn = props.importFn || defaultImportFn;
    const hasComponent = componentMap.has(props.data.chunk);
    if (!hasComponent) {
      const component = await importFn(props.data.chunk);
      componentMap.set(props.data.chunk, component);
    }
    return () => {
      const component = componentMap.get(props.data.chunk);
      const slots = Object.fromEntries(
        Object.entries(props.data.slots || {}).map(([key, value]) => {
          return [
            key,
            () =>
              renderChildren(
                value as VServerComponent | VServerComponent[] | undefined,
                importFn,
              ),
          ];
        }),
      );
      if (component) {
        return h(component, props.data.props, slots);
      }
    };
  },
});
