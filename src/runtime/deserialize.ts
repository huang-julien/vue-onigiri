import { createTextVNode, type VNode, h, Fragment, Suspense } from "vue";
import { VServerComponentType, type VServerComponent } from "./shared";
import loader from "./loader";

export function renderServerComponent(
  input?: VServerComponent,
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
        ? input.children.map((v) => renderServerComponent(v))
        : renderServerComponent(input.children),
    );
  }
  if (input.type === VServerComponentType.Component) {
    return h(loader, {
      data: input,
    });
  }
  if (input.type === VServerComponentType.Fragment) {
    return Array.isArray(input.children)
      ? h(
          Fragment,
          input.children.map((v) => renderServerComponent(v)),
        )
      : renderServerComponent(input.children);
  }
  if (input.type === VServerComponentType.Suspense) {
    return h(
      Suspense,
      {},
      {
        default: () => renderChildren(input.children),
      },
    );
  }
}

export function renderChildren(
  data: VServerComponent | VServerComponent[] | undefined,
): VNode | undefined {
  if (!data) return;
  return Array.isArray(data)
    ? h(
        Fragment,
        data.map((v) => renderServerComponent(v)),
      )
    : renderServerComponent(data);
}
