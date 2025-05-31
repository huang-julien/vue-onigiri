import { h, type DefineComponent, defineComponent, inject } from "vue";
import type { VServerComponentComponent } from "./shared";
import { renderChildren } from "./deserialize";
import { INJECTION_KEY } from "./plugin";


export default defineComponent({
  name: "vsc:loader",
  props: {
    data: {
      type: Object as () => VServerComponentComponent,
      required: true,
    },
  },
  async setup(props) {
    const componentMap = inject(
      INJECTION_KEY,
      new Map<string, DefineComponent>(),
    )
    const hasComponent = componentMap.has(props.data.chunk);
    if (!hasComponent) {
      const { default: component } = await import(
        /* @vite-ignore */ props.data.chunk
      );
      componentMap.set(props.data.chunk, component);
    }
    return () => {
      const component = componentMap.get(props.data.chunk);
      const slots = Object.fromEntries(
        Object.entries(props.data.slots || {}).map(([key, value]) => {
          return [key, () => renderChildren(value)];
        }),
      );
      if (component) {
        return h(component, props.data.props, slots);
      }
    };
  },
});
