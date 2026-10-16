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
  type VServerComponentComponent,
} from "./shared";
import loader from "./loader";
import type { ImportFn } from "./utils";

/** Options shared by AST and HTML island rendering. */
export interface RenderOnigiriOptions {
  /** Resolve a client component from its serialized descriptor. */
  importFn?: ImportFn;
}

/** Reconstruct a Vue tree from an AST or versioned payload. */
export function renderOnigiri(
  input?: VServerComponent | OnigiriPayload,
  options?: RenderOnigiriOptions,
): VNode | undefined {
  const ast = resolveOnigiriInput(input);
  if (!ast) return;
  input = ast;

  switch (input[0]) {
    case VServerComponentType.Element: {
      const children = input[3];
      return createElementVNode(
        input[1],
        normalizeProps(input[2]),
        typeof children === "string" ? children : renderList(children, options),
      );
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
      return renderClientComponent(input, options);
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

/** Render AST children inside a fragment. */
export function renderChildren(
  data: VServerComponent[] | undefined,
  options?: RenderOnigiriOptions,
): VNode | undefined {
  if (!data) return;
  return createElementVNode(Fragment, null, renderList(data, options));
}

/** Compiled templates ship class and style bindings as objects; `h()` used to normalize them. */
export function normalizeProps(props: Record<string, any> | undefined): Record<string, any> | null {
  if (!props) return null;
  const { class: klass, style } = props;
  if (klass != null && typeof klass !== "string") props.class = normalizeClass(klass);
  if (style != null && typeof style !== "string") props.style = normalizeStyle(style);
  return props;
}

/** Resolve and validate the versioned island envelope. */
export function resolveOnigiriInput(
  input: VServerComponent | OnigiriPayload | undefined,
): VServerComponent | undefined {
  if (!input || Array.isArray(input)) return input;
  if (input.v !== ONIGIRI_PAYLOAD_VERSION) {
    throw new Error(
      `[vue-onigiri] Unsupported payload version: ${input.v}. Expected: ${ONIGIRI_PAYLOAD_VERSION}`,
    );
  }
  return input.ast;
}

/** Keep component loading inside the surrounding Vue render context. */
export function renderClientComponent(
  data: VServerComponentComponent,
  options?: RenderOnigiriOptions,
): VNode {
  return h(Suspense, {}, { default: () => h(loader, { data, importFn: options?.importFn }) });
}

/** Give a marked suspense region deterministic fragment anchors. */
export function renderMarkedSuspense(
  children: VNode[],
  fallback: VServerComponent[] | undefined,
  options?: RenderOnigiriOptions,
): VNode {
  return h(
    Suspense,
    {},
    {
      default: () => createElementVNode(Fragment, null, children),
      fallback: () => renderChildren(fallback, options),
    },
  );
}

function renderList(
  nodes: VServerComponent[] | undefined,
  options?: RenderOnigiriOptions,
): (VNode | undefined)[] | null {
  if (!nodes) return null;
  return nodes.map((node) => renderOnigiri(node, options));
}
