import { mergeProps, type ObjectDirective } from "vue";
import type { VServerComponentBuffered, VServerComponent } from "./shared";
import { VServerComponentType } from "./shared";

export interface ObjectDirectiveBinding<V = any> {
  value: V;
  arg?: string;
  modifiers: Record<string, boolean>;
}

// `transformOnigiri` augmentation lives in `src/types.ts`.

/**
 * Directive resolver function type.
 * Used to resolve string directive names to directive objects.
 */
export type DirectiveResolver = (name: string) => ObjectDirective | undefined;

/**
 * Module-scoped resolver for custom directives referenced by string name
 * from compiled templates. Set once at app bootstrap. An app-scoped
 * alternative would be cleaner but would require threading through every
 * compiled render function; this is the pragmatic trade-off.
 */
let globalDirectiveResolver: DirectiveResolver | undefined;
export function setDirectiveResolver(resolver: DirectiveResolver): void {
  globalDirectiveResolver = resolver;
}

export function getDirectiveResolver(): DirectiveResolver | undefined {
  return globalDirectiveResolver;
}

/**
 * Runtime helper to apply a directive transformation to a VServerComponent node.
 *
 * Used by the onigiri template compiler to wrap elements with directives:
 *
 * ```vue
 * <div v-tip="message" />
 * ```
 *
 * Compiles to:
 *
 * ```javascript
 * __withDirective('tip', [0, "div", undefined, undefined], { value: _ctx.message, modifiers: {} })
 * // or if imported:
 * __withDirective(vTip, [0, "div", undefined, undefined], { value: _ctx.message, modifiers: {} })
 * ```
 */
export function withDirective(
  directive: string | ObjectDirective,
  node: VServerComponentBuffered,
  binding: Partial<ObjectDirectiveBinding> = {},
): VServerComponentBuffered {
  let dir: ObjectDirective | undefined;
  // disable for clarity

  if (typeof directive === "string") {
    dir = builtInDirectives[directive] ?? globalDirectiveResolver?.(directive);
  } else {
    dir = directive;
  }

  const normalizedBinding: ObjectDirectiveBinding = {
    value: binding.value,
    arg: binding.arg,
    modifiers: binding.modifiers ?? {},
  };

  if (dir?.transformOnigiri) {
    // Directives operate on resolved VServerComponent nodes. The buffered
    // variant is structurally identical but may contain Promises in children;
    // transforms that only touch props/tag are safe to apply here.
    return dir.transformOnigiri(
      node as VServerComponent,
      normalizedBinding,
    ) as VServerComponentBuffered;
  }

  // Compatibility path for stock Vue directives (`{ mounted, updated, … }`).
  // Vue's official SSR contribution hook is `getSSRProps` — same one Vue's
  // own `vShow` uses — so honor it here when no onigiri-specific transform
  // is provided. The returned props are merged onto the element's attrs.
  if (dir?.getSSRProps && node[0] === VServerComponentType.Element) {
    // `getSSRProps` expects Vue's `DirectiveBinding` (with `instance`,
    // `oldValue`, `dir` fields). At serialize time only value/arg/modifiers
    // are meaningful, so we pass the same shape with the rest as `null`.
    const ssrBinding = {
      ...normalizedBinding,
      instance: null,
      oldValue: null,
      dir,
    };
    const ssrProps = dir.getSSRProps(ssrBinding as any, node as any);
    if (ssrProps) {
      const [type, tag, props, children] = node as [
        number,
        string,
        Record<string, any> | undefined,
        any,
      ];
      return [type, tag, mergeProps(props || {}, ssrProps), children] as VServerComponentBuffered;
    }
  }

  return node;
}

/**
 * Alias for withDirective, used as the import name in compiled code
 */
export { withDirective as __withDirective };

/**
 * Count top-level nodes in an HTML string. Vue's `createStaticVNode`
 * requires the number of root nodes for correct hydration boundaries.
 * A simple character-level parser avoids pulling in a full HTML parser.
 */
function countHtmlRootNodes(html: string): number {
  if (!html) return 0;

  let count = 0;
  let depth = 0;
  let i = 0;

  while (i < html.length) {
    const char = html[i];
    if (depth === 0 && char && /\s/.test(char)) {
      i++;
      continue;
    }

    if (html[i] === "<") {
      if (html[i + 1] === "/") {
        depth--;
        i = html.indexOf(">", i) + 1;
      } else if (html[i + 1] === "!") {
        // Comment or DOCTYPE - skip

        if (html.slice(i, i + 4) === "<!--") {
          i = html.indexOf("-->", i) + 3;
        } else {
          i = html.indexOf(">", i) + 1;
        }
        if (depth === 0) count++;
      } else {
        if (depth === 0) count++;
        const tagEnd = html.indexOf(">", i);
        if (html[tagEnd - 1] !== "/") {
          const tagMatch = html.slice(i + 1, tagEnd).match(/^(\w+)/);
          const tagName = tagMatch?.[1]?.toLowerCase();
          const voidElements = new Set([
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
          ]);
          if (!voidElements.has(tagName ?? "")) {
            depth++;
          }
        }
        i = tagEnd + 1;
      }
    } else {
      if (depth === 0) {
        count++;
        while (i < html.length && html[i] !== "<") i++;
      } else {
        i++;
      }
    }

    if (i <= 0) break;
  }

  return Math.max(1, count);
}

/**
 * Built-in v-html directive handler.
 * Replaces the element's children with a StaticHtml node.
 * Uses createStaticVNode for efficient hydration on the client.
 */
export const vHtml: ObjectDirective<HTMLElement, string> = {
  transformOnigiri(node, binding) {
    if (node[0] !== VServerComponentType.Element) return node;
    const [type, tag, props, _children] = node as [
      number,
      string,
      Record<string, any> | undefined,
      any,
    ];

    const htmlContent = String(binding.value ?? "");
    if (!htmlContent) {
      return [type, tag, props, undefined] as VServerComponent;
    }

    const nodeCount = countHtmlRootNodes(htmlContent);

    // Replace children with a single StaticHtml child
    const staticHtmlChild: VServerComponent = [
      VServerComponentType.StaticHtml,
      htmlContent,
      nodeCount,
    ];
    return [type, tag, props, [staticHtmlChild]] as VServerComponent;
  },
};

export const vText: ObjectDirective<HTMLElement, string> = {
  transformOnigiri(node, binding) {
    if (node[0] !== VServerComponentType.Element) return node;
    const [type, tag, props, _children] = node as [
      number,
      string,
      Record<string, any> | undefined,
      any,
    ];
    const textContent = String(binding.value ?? "");
    return [
      type,
      tag,
      props,
      textContent ? [[VServerComponentType.Text, textContent]] : undefined,
    ] as VServerComponent;
  },
};

export const vShow: ObjectDirective<HTMLElement, boolean> = {
  transformOnigiri(node, binding) {
    if (node[0] !== VServerComponentType.Element) return node;
    const [type, tag, props, children] = node as [
      number,
      string,
      Record<string, any> | undefined,
      any,
    ];

    if (!binding.value) {
      // Hide element by setting display: none
      const existingStyle = props?.style || {};
      const newStyle
        = typeof existingStyle === "string"
          ? existingStyle + "; display: none"
          : { ...existingStyle, display: "none" };

      return [type, tag, { ...props, style: newStyle }, children] as VServerComponent;
    }

    return node;
  },
};

export const vModel: ObjectDirective<HTMLElement, any> = {
  transformOnigiri(node, binding) {
    if (node[0] !== VServerComponentType.Element) return node;
    const [type, tag, props, children] = node as [
      number,
      string,
      Record<string, any> | undefined,
      any,
    ];

    // Set value attribute for input elements
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return [type, tag, { ...props, value: binding.value }, children] as VServerComponent;
    }

    return node;
  },
};

const builtInDirectives: Record<string, ObjectDirective> = {
  html: vHtml,
  text: vText,
  show: vShow,
  model: vModel,
};

export function createDirectiveResolver(appResolver?: DirectiveResolver): DirectiveResolver {
  return (name: string) => {
    // Check built-in directives first
    if (builtInDirectives[name]) {
      return builtInDirectives[name];
    }
    // Fall back to app resolver
    return appResolver?.(name);
  };
}
