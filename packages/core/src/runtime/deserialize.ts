import {
  createTextVNode,
  createCommentVNode,
  createStaticVNode,
  createElementVNode,
  createVNode,
  normalizeClass,
  normalizeStyle,
  type VNode,
  h,
  Fragment,
  Suspense,
  Teleport,
} from "vue";
import {
  VServerComponentType,
  ONIGIRI_PAYLOAD_VERSION,
  type OnigiriPayload,
  type VServerComponent,
} from "./shared";
import loader from "./loader";
import type { ImportFn } from "./utils";

export interface RenderOnigiriOptions {
  importFn?: ImportFn;
}

export function renderOnigiri(
  input?: VServerComponent | OnigiriPayload,
  options?: RenderOnigiriOptions,
): VNode | undefined {
  if (!input) return;

  if (!Array.isArray(input)) {
    if (input.v !== ONIGIRI_PAYLOAD_VERSION) {
      throw new Error(
        `[vue-onigiri] Unsupported payload version: ${input.v}. Expected: ${ONIGIRI_PAYLOAD_VERSION}`,
      );
    }
    return input.ast ? renderOnigiri(input.ast, options) : undefined;
  }

  switch (input[0]) {
    case VServerComponentType.Element: {
      return createElementVNode(input[1], normalizeProps(input[2]), renderList(input[3], options));
    }
    case VServerComponentType.Text: {
      return createTextVNode(input[1]);
    }
    case VServerComponentType.Fragment: {
      return Array.isArray(input[1])
        ? createElementVNode(Fragment, null, renderList(input[1], options))
        : renderOnigiri(input[1], options);
    }
    case VServerComponentType.Comment: {
      return createCommentVNode(input[1]);
    }
    case VServerComponentType.Component: {
      return h(
        Suspense,
        {},
        {
          default: () => h(loader, { data: input, importFn: options?.importFn }),
        },
      );
    }
    case VServerComponentType.Suspense: {
      return h(
        Suspense,
        {},
        {
          default: () => renderChildren(input[1], options),
          ...(input[2] && input[2].length > 0
            ? { fallback: () => renderChildren(input[2], options) }
            : {}),
        },
      );
    }
    case VServerComponentType.Teleport: {
      return createVNode(
        Teleport,
        { to: input[1], disabled: input[2] ?? false },
        renderList(input[3], options),
      );
    }
    case VServerComponentType.StaticHtml: {
      return createStaticVNode(input[1], input[2]);
    }
    default: {
      return undefined;
    }
  }
}

export function renderChildren(
  data: VServerComponent[] | undefined,
  options?: RenderOnigiriOptions,
): VNode | undefined {
  if (!data) return;
  return createElementVNode(Fragment, null, renderList(data, options));
}

function renderList(
  nodes: VServerComponent[] | undefined,
  options?: RenderOnigiriOptions,
): (VNode | undefined)[] | null {
  if (!nodes) return null;
  return nodes.map((node) => renderOnigiri(node, options));
}

/** Compiled templates ship class and style bindings as objects; `h()` used to normalize them. */
function normalizeProps(props: Record<string, any> | undefined): Record<string, any> | null {
  if (!props) return null;
  const { class: klass, style } = props;
  if (klass != null && typeof klass !== "string") props.class = normalizeClass(klass);
  if (style != null && typeof style !== "string") props.style = normalizeStyle(style);
  return props;
}
