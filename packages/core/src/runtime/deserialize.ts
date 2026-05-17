import { createTextVNode, createStaticVNode, type VNode, h, Fragment, Suspense } from "vue";
import { VServerComponentType, type VServerComponent } from "./shared";
import loader from "./loader";
import type { ImportFn } from "./utils";

export interface RenderOnigiriOptions {
  importFn?: ImportFn;
}

export function renderOnigiri(
  input?: VServerComponent,
  options?: RenderOnigiriOptions,
): VNode | undefined {
  if (!input) return;

  if (input[0] === VServerComponentType.Text) {
    return createTextVNode(input[1]);
  }
  if (input[0] === VServerComponentType.Element) {
    return h(
      input[1],
      input[2],
      input[3]?.map((v) => renderOnigiri(v as VServerComponent, options)),
    );
  }
  if (input[0] === VServerComponentType.Component) {
    // Wrap in `<Suspense>` so the loader's async setup (which awaits
    // the chunk import) participates in SSR's async render and
    // client hydration. Without this, async setup throws on hydration
    // with a "Component <Suspense> requires a default slot" warning.
    return h(
      Suspense,
      {},
      {
        default: () => h(loader, { data: input, importFn: options?.importFn }),
      },
    );
  }
  if (input[0] === VServerComponentType.Fragment) {
    return Array.isArray(input[1])
      ? h(
          Fragment,
          input[1].map((v) => renderOnigiri(v, options)),
        )
      : renderOnigiri(input[1], options);
  }
  if (input[0] === VServerComponentType.Suspense) {
    return h(
      Suspense,
      {},
      {
        default: () => renderChildren(input[1], options),
      },
    );
  }
  if (input[0] === VServerComponentType.StaticHtml) {
    return createStaticVNode(input[1], input[2]);
  }
}

export function renderChildren(
  data: VServerComponent[] | undefined,
  options?: RenderOnigiriOptions,
): VNode | undefined {
  if (!data) return;
  return h(
    Fragment,
    data.map((v) => renderOnigiri(v, options)),
  );
}
