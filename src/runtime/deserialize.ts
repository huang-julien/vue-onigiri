import { createTextVNode, type VNode, h, Fragment, Suspense } from "vue";
import { VServerComponentType, type VServerComponent } from "./shared";
import loader from "./loader";
import { defaultImportFn } from "./utils";

export function renderServerComponent(
  input?: VServerComponent,
  importFn = defaultImportFn,
): VNode | undefined {
  if (!input) return;
  if (input.type === VServerComponentType.Text) {
    return createTextVNode(input.text);
  }
  if (input.type === VServerComponentType.Element) {
    return h(
      input.tag,
      input.props,
      Array.isArray(input.children)
        ? input.children.map((v) => renderServerComponent(v, importFn))
        : renderServerComponent(input.children, importFn),
    );
  }
  if (input.type === VServerComponentType.Component) {
    return h(loader, {
      data: input,
      importFn: importFn,
    });
  }
  if (input.type === VServerComponentType.Fragment) {
    return Array.isArray(input.children)
      ? h(
          Fragment,
          input.children.map((v) => renderServerComponent(v, importFn)),
        )
      : renderServerComponent(input.children, importFn);
  }
  if (input.type === VServerComponentType.Suspense) {
    return h(
      Suspense,
      {},
      {
        default: () => renderChildren(input.children, importFn),
      },
    );
  }
}

export function renderChildren(
  data: VServerComponent | VServerComponent[] | undefined,
  importFn = defaultImportFn,
): VNode | undefined {
  if (!data) return;
  return Array.isArray(data)
    ? h(
        Fragment,
        data.map((v) => renderServerComponent(v, importFn)),
      )
    : renderServerComponent(data, importFn);
}
