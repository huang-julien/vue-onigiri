import {
  type AttributeNode,
  type DirectiveNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-dom";
import { genImport, genString } from "knitwork";
import type { CodegenContext } from "./context";
import { genEventHandler, genExpressionAsValue } from "./expressions";
import { STRIPPED_DIRECTIVES, shouldWrapDirective } from "./directives";

/**
 * Position of the props being generated: element props carry the scopeId and leave
 * v-model to the runtime-directive path, component props expand it to `modelValue`.
 */
export type PropsMode = "element" | "component";

/** Props generator for both element and component positions. Defaults to component mode. */
export function genProps(
  props: (AttributeNode | DirectiveNode)[],
  context: CodegenContext,
  mode: PropsMode = "component",
): void {
  const bindDirective = props.find((prop) => isBareBind(prop)) as DirectiveNode | undefined;

  if (!bindDirective) {
    genPropsObjectBody(props, context, mode);
    return;
  }

  const otherProps = props.filter((prop) => !isBareBind(prop));
  const isElement = mode === "element";

  if (!isElement && otherProps.length === 0) {
    if (bindDirective.exp) {
      genExpressionAsValue(bindDirective.exp, context);
    } else {
      context.push("undefined");
    }
    return;
  }

  context.imports.add(genImport("vue", [{ name: "mergeProps", as: "_mergeProps" }]));
  context.push("_mergeProps(");

  if (bindDirective.exp) {
    genExpressionAsValue(bindDirective.exp, context);
  } else {
    context.push(isElement ? "{}" : "undefined");
  }

  if (!isElement || otherProps.length > 0 || context.scopeId) {
    context.push(", ");
    genPropsObjectBody(otherProps, context, mode);
  }

  context.push(")");
}

function isBareBind(prop: AttributeNode | DirectiveNode): boolean {
  return prop.type === NodeTypes.DIRECTIVE && prop.name === "bind" && !prop.arg;
}

/** Dynamic args (`:[name]` / `@[name]`) need computed keys; quoting their content would emit a literal `"_ctx.name"` prop. */
function isDynamicArg(arg: DirectiveNode["arg"]): boolean {
  if (!arg || typeof arg !== "object") return false;
  if (arg.type === NodeTypes.SIMPLE_EXPRESSION) return !arg.isStatic;
  return true;
}

const EVENT_OPTION_MODIFIERS = new Set(["passive", "once", "capture"]);
const NON_KEY_MODIFIERS = new Set([
  "stop",
  "prevent",
  "self",
  "ctrl",
  "shift",
  "alt",
  "meta",
  "exact",
  "middle",
]);
const MAYBE_KEY_MODIFIERS = new Set(["left", "right"]);
const KEYBOARD_EVENTS = new Set(["keyup", "keydown", "keypress"]);

function resolveVOnModifiers(
  prop: DirectiveNode,
  staticEvent: string | null,
): { eventOptions: string[]; nonKey: string[]; keys: string[] } {
  const eventOptions: string[] = [];
  const nonKey: string[] = [];
  const keys: string[] = [];

  for (const mod of prop.modifiers ?? []) {
    const name = typeof mod === "string" ? mod : (mod as SimpleExpressionNode).content;
    if (EVENT_OPTION_MODIFIERS.has(name)) {
      eventOptions.push(name);
    } else if (NON_KEY_MODIFIERS.has(name)) {
      nonKey.push(name);
    } else if (MAYBE_KEY_MODIFIERS.has(name)) {
      if (staticEvent === null) {
        keys.push(name);
        nonKey.push(name);
      } else if (KEYBOARD_EVENTS.has(staticEvent.toLowerCase())) {
        keys.push(name);
      } else {
        nonKey.push(name);
      }
    } else {
      keys.push(name);
    }
  }

  return { eventOptions, nonKey, keys };
}

const camelize = (name: string): string =>
  name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const capitalize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** Emit one `key: value` object entry for a `v-on:*` / `v-bind:arg` directive. */
function genDirectivePropEntry(prop: DirectiveNode, context: CodegenContext): void {
  if (prop.name === "on") {
    const staticEvent =
      !isDynamicArg(prop.arg) && prop.arg && typeof prop.arg === "object" && "content" in prop.arg
        ? (prop.arg as SimpleExpressionNode).content
        : null;
    const { eventOptions, nonKey, keys } = resolveVOnModifiers(prop, staticEvent);
    const optionSuffix = eventOptions.map((option) => capitalize(option)).join("");

    if (staticEvent === null) {
      // `@[eventName]`: computed handler key via Vue's own helper,
      // matching the `_toHandlerKey(...)` shape Vue's codegen emits.
      context.imports.add(genImport("vue", [{ name: "toHandlerKey", as: "_toHandlerKey" }]));
      context.push("[_toHandlerKey(");
      genExpressionAsValue(prop.arg, context);
      context.push(")");
      if (optionSuffix) context.push(` + ${genString(optionSuffix)}`);
      context.push("]: ");
    } else {
      context.push(`${genString(`on${capitalize(camelize(staticEvent))}${optionSuffix}`)}: `);
    }

    const useKeys =
      keys.length > 0 && (staticEvent === null || KEYBOARD_EVENTS.has(staticEvent.toLowerCase()));
    if (useKeys) {
      context.imports.add(genImport("vue", [{ name: "withKeys", as: "_withKeys" }]));
      context.push("_withKeys(");
    }
    if (nonKey.length > 0) {
      context.imports.add(genImport("vue", [{ name: "withModifiers", as: "_withModifiers" }]));
      context.push("_withModifiers(");
    }

    if (prop.exp) {
      genEventHandler(prop.exp, context);
    } else {
      context.push("() => {}");
    }

    if (nonKey.length > 0) {
      context.push(`, [${nonKey.map((mod) => genString(mod)).join(",")}])`);
    }
    if (useKeys) {
      context.push(`, [${keys.map((key) => genString(key)).join(",")}])`);
    }
    return;
  }

  // v-bind with an arg (`:name="x"` / `:[name]="x"`).
  if (isDynamicArg(prop.arg)) {
    context.push("[");
    genExpressionAsValue(prop.arg, context);
    context.push("]: ");
  } else {
    const propName =
      prop.arg && typeof prop.arg === "object" && "content" in prop.arg
        ? (prop.arg as SimpleExpressionNode).content
        : "";
    context.push(`${genString(propName)}: `);
  }

  if (prop.exp) {
    genExpressionAsValue(prop.exp, context);
  } else {
    context.push("true");
  }
}

function collectClassStyleMerges(props: (AttributeNode | DirectiveNode)[]): {
  merged: Set<AttributeNode | DirectiveNode>;
  merges: Array<{ name: "class" | "style"; parts: (AttributeNode | DirectiveNode)[] }>;
} {
  const merged = new Set<AttributeNode | DirectiveNode>();
  const merges: Array<{ name: "class" | "style"; parts: (AttributeNode | DirectiveNode)[] }> = [];

  for (const name of ["class", "style"] as const) {
    const parts = props.filter(
      (prop) =>
        (prop.type === NodeTypes.ATTRIBUTE && prop.name === name) ||
        (prop.type === NodeTypes.DIRECTIVE &&
          prop.name === "bind" &&
          !!prop.arg &&
          !isDynamicArg(prop.arg) &&
          (prop.arg as SimpleExpressionNode).content === name),
    );
    if (parts.length > 1) {
      for (const part of parts) merged.add(part);
      merges.push({ name, parts });
    }
  }

  return { merged, merges };
}

function genClassStyleMerge(
  merge: { name: "class" | "style"; parts: (AttributeNode | DirectiveNode)[] },
  context: CodegenContext,
): void {
  const helper = merge.name === "class" ? "normalizeClass" : "normalizeStyle";
  context.imports.add(genImport("vue", [{ name: helper, as: `_${helper}` }]));

  context.push(`${genString(merge.name)}: _${helper}([`);
  for (const [i, part] of merge.parts.entries()) {
    if (i > 0) context.push(", ");
    if (part.type === NodeTypes.ATTRIBUTE) {
      context.push(part.value ? genString(part.value.content) : '""');
    } else {
      genExpressionAsValue((part as DirectiveNode).exp, context);
    }
  }
  context.push("])");
}

function genComponentVModel(prop: DirectiveNode, context: CodegenContext): void {
  const dynamicArg = isDynamicArg(prop.arg);
  const staticName =
    !dynamicArg && prop.arg && typeof prop.arg === "object" && "content" in prop.arg
      ? (prop.arg as SimpleExpressionNode).content
      : "modelValue";

  const pushArgKey = (prefix: string, suffix: string): void => {
    if (dynamicArg) {
      context.push(`[${genString(prefix)} + (`);
      genExpressionAsValue(prop.arg, context);
      context.push(`)${suffix ? ` + ${genString(suffix)}` : ""}]: `);
    } else {
      context.push(`${genString(`${prefix}${staticName}${suffix}`)}: `);
    }
  };

  pushArgKey("", "");
  genExpressionAsValue(prop.exp, context);
  context.push(", ");

  pushArgKey("onUpdate:", "");
  context.push("$event => ((");
  genExpressionAsValue(prop.exp, context);
  context.push(") = $event)");

  if (prop.modifiers && prop.modifiers.length > 0) {
    context.push(", ");
    if (dynamicArg) {
      pushArgKey("", "Modifiers");
    } else {
      context.push(
        `${genString(`${staticName === "modelValue" ? "model" : staticName}Modifiers`)}: `,
      );
    }
    context.push("{");
    for (const [i, mod] of prop.modifiers.entries()) {
      if (i > 0) context.push(", ");
      const modName = typeof mod === "string" ? mod : (mod as SimpleExpressionNode).content;
      context.push(`${genString(modName)}: true`);
    }
    context.push("}");
  }
}

function genPropsObjectBody(
  props: (AttributeNode | DirectiveNode)[],
  context: CodegenContext,
  mode: PropsMode,
): void {
  const isElement = mode === "element";

  context.push("{");
  let first = true;

  if (isElement && context.scopeId) {
    context.push(`${genString(context.scopeId)}: ""`);
    first = false;
  }

  const { merged, merges } = collectClassStyleMerges(props);
  for (const merge of merges) {
    if (!first) context.push(", ");
    first = false;
    genClassStyleMerge(merge, context);
  }

  for (const prop of props) {
    if (merged.has(prop)) continue;

    if (prop.type === NodeTypes.ATTRIBUTE) {
      if (!first) context.push(", ");
      first = false;

      context.push(`${genString(prop.name)}: `);
      if (prop.value) {
        context.push(genString(prop.value.content));
      } else {
        context.push("true");
      }
    } else if (prop.type === NodeTypes.DIRECTIVE) {
      if (!isElement && prop.name === "model" && prop.exp) {
        if (!first) context.push(", ");
        first = false;

        genComponentVModel(prop, context);
        continue;
      }
      if (STRIPPED_DIRECTIVES.has(prop.name)) continue;
      if (shouldWrapDirective(prop.name)) continue;
      if (prop.name !== "on" && !(prop.name === "bind" && prop.arg)) continue;

      if (!first) context.push(", ");
      first = false;

      genDirectivePropEntry(prop, context);
    }
  }

  context.push("}");
}
