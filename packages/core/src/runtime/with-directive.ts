import { mergeProps, type ComponentInternalInstance, type ObjectDirective } from "vue";
import { isPromise, looseEqual, looseIndexOf } from "@vue/shared";
import type { VServerComponentBuffered, VServerComponent } from "./shared";
import { VServerComponentType } from "./shared";

export interface ObjectDirectiveBinding<V = any> {
  value: V;
  arg?: string;
  modifiers: Record<string, boolean>;
}

// resolve directive from instance or app context
function resolveInstanceDirective(
  instance: ComponentInternalInstance | undefined,
  name: string,
): ObjectDirective | undefined {
  const local = (instance?.type as any)?.directives?.[name];
  return local ?? instance?.appContext?.directives?.[name];
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
  instance?: ComponentInternalInstance,
): VServerComponentBuffered {
  let dir: ObjectDirective | undefined;

  if (typeof directive === "string") {
    dir = builtInDirectives[directive] ?? resolveInstanceDirective(instance, directive);
    if (!dir && (typeof __DEV__ === "undefined" || __DEV__)) {
      console.warn(`[vue-onigiri] Failed to resolve directive: ${directive}`);
    }
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

const VOID_HTML_ELEMENTS = new Set([
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

const RAWTEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

function findTagEnd(html: string, from: number): number {
  let quote: string | undefined;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === "\"" || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

function countHtmlRootNodes(html: string): number {
  if (!html) return 0;

  let count = 0;
  let depth = 0;
  let i = 0;

  while (i < html.length) {
    if (html[i] !== "<") {
      // Text run up to the next tag; whitespace-only runs are real text nodes.
      if (depth === 0) count++;
      while (i < html.length && html[i] !== "<") i++;
      continue;
    }

    const next = html[i + 1] ?? "";

    if (next === "/") {
      if (depth > 0) depth--;
      const end = html.indexOf(">", i);
      if (end === -1) break;
      i = end + 1;
    } else if (html.startsWith("<!--", i)) {
      if (depth === 0) count++;
      const end = html.indexOf("-->", i + 4);
      if (end === -1) break;
      i = end + 3;
    } else if (next === "!" || next === "?") {
      // Doctype / processing instruction: dropped by fragment parsing.
      const end = html.indexOf(">", i);
      if (end === -1) break;
      i = end + 1;
    } else if (/[a-zA-Z]/.test(next)) {
      const end = findTagEnd(html, i + 1);
      if (end === -1) break;
      const tagName
        = html.slice(i + 1, end).match(/^([a-zA-Z][\w-]*)/)?.[1]?.toLowerCase() ?? "";
      if (depth === 0) count++;
      const selfClosing = html[end - 1] === "/";
      i = end + 1;

      if (VOID_HTML_ELEMENTS.has(tagName) || selfClosing) continue;

      if (RAWTEXT_ELEMENTS.has(tagName)) {
        const close = html.toLowerCase().indexOf(`</${tagName}`, i);
        if (close === -1) break;
        const closeEnd = html.indexOf(">", close);
        if (closeEnd === -1) break;
        i = closeEnd + 1;
        continue;
      }

      depth++;
    } else {
      if (depth === 0) count++;
      i++;
      while (i < html.length && html[i] !== "<") i++;
    }
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

function isChecked(modelValue: any, elementValue: any): boolean {
  if (Array.isArray(modelValue)) return looseIndexOf(modelValue, elementValue) > -1;
  if (modelValue instanceof Set) return modelValue.has(elementValue);
  return !!modelValue;
}

function getOptionValue(props: Record<string, any> | undefined, children: any): any {
  if (props && "value" in props) return props.value;
  if (Array.isArray(children) && children[0]?.[0] === VServerComponentType.Text) {
    return children[0][1];
  }
  return undefined;
}

function markSelectedOptions(children: any, modelValue: any, multiple: boolean): any {
  if (isPromise(children)) {
    return children.then((resolved: any) => markSelectedOptions(resolved, modelValue, multiple));
  }
  if (!Array.isArray(children)) return children;

  return children.map((child: any) => {
    if (!Array.isArray(child) || child[0] !== VServerComponentType.Element) return child;
    const [type, tag, props, optionChildren] = child;
    if (tag === "optgroup") {
      return [type, tag, props, markSelectedOptions(optionChildren, modelValue, multiple)];
    }
    if (tag !== "option") return child;

    const optionValue = getOptionValue(props, optionChildren);
    const selected = multiple
      ? isChecked(modelValue, optionValue)
      : looseEqual(modelValue, optionValue);
    return selected ? [type, tag, { ...props, selected: true }, optionChildren] : child;
  });
}

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
    if (tag === "input" && props?.type === "checkbox") {
      return isChecked(binding.value, props?.value)
        ? ([type, tag, { ...props, checked: true }, children] as VServerComponent)
        : node;
    }

    if (tag === "input" && props?.type === "radio") {
      return looseEqual(binding.value, props?.value)
        ? ([type, tag, { ...props, checked: true }, children] as VServerComponent)
        : node;
    }

    if (tag === "select") {
      const multiple = !!props?.multiple;
      return [type, tag, props, markSelectedOptions(children, binding.value, multiple)] as VServerComponent;
    }

    if (tag === "input" || tag === "textarea") {
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
