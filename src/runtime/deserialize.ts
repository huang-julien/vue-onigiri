import { createTextVNode, createStaticVNode, type VNode, h, Fragment, Suspense } from "vue";
import { VServerComponentType, type VServerComponent } from "./shared";
import loader from "./loader";
import { defaultImportFn, type ImportFn } from "./utils";

/**
 * Slots that can be passed to renderOnigiri.
 * Each slot can be either:
 * - Pre-serialized VServerComponent array
 * - A function that returns VNode(s) - for dynamic client-side slots
 */
export type OnigiriSlots = Record<
  string,
  VServerComponent[] | ((props?: Record<string, any>) => VNode | VNode[] | undefined)
>;

export function renderOnigiri(
  input?: VServerComponent,
  importFn = defaultImportFn,
  slots?: OnigiriSlots,
): VNode | undefined {
  if (!input) return;

  if (input[0] === VServerComponentType.Text) {
    return createTextVNode(input[1]);
  }
  if (input[0] === VServerComponentType.Element) {
    return h(
      input[1],
      input[2],
      input[3]?.map((v) => renderOnigiri(v as VServerComponent, importFn, slots)),
    );
  }
  if (input[0] === VServerComponentType.Component) {
    return h(loader, {
      data: input,
      importFn: importFn,
    });
  }
  if (input[0] === VServerComponentType.Fragment) {
    return Array.isArray(input[1])
      ? h(
          Fragment,
          input[1].map((v) => renderOnigiri(v, importFn, slots)),
        )
      : renderOnigiri(input[1], importFn, slots);
  }
  if (input[0] === VServerComponentType.Suspense) {
    return h(
      Suspense,
      {},
      {
        default: () => renderChildren(input[1], importFn, slots),
      },
    );
  }
  if (input[0] === VServerComponentType.StaticHtml) {
    return createStaticVNode(input[1], input[2]);
  }
  if (input[0] === VServerComponentType.Slot) {
    const [, name, slotProps, fallback] = input;
    const slot = slots?.[name];
console.log('render slot marker:', name);
    if (slot) {
      // Slot provided
      if (typeof slot === 'function') {
        // Client-side slot function
        const result = slot(slotProps);
        if (result === undefined) {
          return renderChildren(fallback, importFn, slots);
        }
        return Array.isArray(result) ? h(Fragment, result) : result;
      }
      // Pre-serialized slot content
      return renderChildren(slot, importFn, slots);
    }
    // No slot provided - use fallback
    return renderChildren(fallback, importFn, slots);
  }
}

export function renderChildren(
  data: VServerComponent[] | undefined,
  importFn: ImportFn = defaultImportFn,
  slots?: OnigiriSlots,
): VNode | undefined {
  if (!data) return;
  return h(
    Fragment,
    data.map((v) => renderOnigiri(v, importFn, slots)),
  );
}
