import {
  type AttributeNode,
  type DirectiveNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-dom";
import { genImport } from "knitwork";
import type { CodegenContext } from "./context";
import { genEventHandler, genExpressionAsValue } from "./expressions";
import { STRIPPED_DIRECTIVES, shouldWrapDirective } from "./directives";

/**
 * Props generator for COMPONENT positions (and `<slot>` outlets, where
 * v-model cannot appear). `v-model` always expands to `modelValue` +
 * `onUpdate:modelValue` (or the `v-model:arg` equivalents), the way Vue
 * compiles v-model on components. Element positions go through
 * `genPropsWithScopeId` instead, where v-model stays on the
 * runtime-directive path (`withDirective` + the built-in SSR vModel
 * transform).
 */
export function genProps(props: (AttributeNode | DirectiveNode)[], context: CodegenContext): void {
  const bindDirective = props.find(
    (prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === "bind" && !prop.arg,
  ) as DirectiveNode | undefined;

  const otherProps = props.filter(
    (prop) => !(prop.type === NodeTypes.DIRECTIVE && prop.name === "bind" && !prop.arg),
  );

  if (bindDirective) {
    if (otherProps.length > 0) {
      context.imports.add(genImport("vue", [{ name: "mergeProps", as: "_mergeProps" }]));
      context.push("_mergeProps(");
      if (bindDirective.exp) {
        genExpressionAsValue(bindDirective.exp, context);
      } else {
        context.push("undefined");
      }
      context.push(", ");

      genPropsObject(otherProps, context);
      context.push(")");
    } else {
      if (bindDirective.exp) {
        genExpressionAsValue(bindDirective.exp, context);
      } else {
        context.push("undefined");
      }
    }
    return;
  }

  genPropsObject(props, context);
}

export function genPropsWithScopeId(
  props: (AttributeNode | DirectiveNode)[],
  context: CodegenContext,
): void {
  const bindDirective = props.find(
    (prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === "bind" && !prop.arg,
  ) as DirectiveNode | undefined;

  const otherProps = props.filter(
    (prop) => !(prop.type === NodeTypes.DIRECTIVE && prop.name === "bind" && !prop.arg),
  );

  if (bindDirective) {
    context.imports.add(genImport("vue", [{ name: "mergeProps", as: "_mergeProps" }]));
    context.push("_mergeProps(");

    if (bindDirective.exp) {
      genExpressionAsValue(bindDirective.exp, context);
    } else {
      context.push("{}");
    }

    if (otherProps.length > 0 || context.scopeId) {
      context.push(", ");
      genPropsObjectWithScopeId(otherProps, context);
    }

    context.push(")");
    return;
  }

  genPropsObjectWithScopeId(props, context);
}

/**
 * `:[name]` / `@[name]` directive args are dynamic expressions
 * (`isStatic: false`, or compound after transformExpression). Emitting
 * their raw `content` as a quoted key produces a literal `"_ctx.name"`
 * prop, so they need a computed key instead.
 */
function isDynamicArg(arg: DirectiveNode["arg"]): boolean {
  if (!arg || typeof arg !== "object") return false;
  if (arg.type === NodeTypes.SIMPLE_EXPRESSION) return !arg.isStatic;
  return true;
}

/** Emit one `key: value` object entry for a `v-on:*` / `v-bind:arg` directive. */
function genDirectivePropEntry(prop: DirectiveNode, context: CodegenContext): void {
  if (prop.name === "on") {
    if (isDynamicArg(prop.arg)) {
      // `@[eventName]`: computed handler key via Vue's own helper,
      // matching the `_toHandlerKey(...)` shape Vue's codegen emits.
      context.imports.add(genImport("vue", [{ name: "toHandlerKey", as: "_toHandlerKey" }]));
      context.push("[_toHandlerKey(");
      genExpressionAsValue(prop.arg, context);
      context.push(")]: ");
    } else {
      const eventName =
        prop.arg && typeof prop.arg === "object" && "content" in prop.arg
          ? (prop.arg as SimpleExpressionNode).content
          : "";
      const onEventName = "on" + eventName.charAt(0).toUpperCase() + eventName.slice(1);
      context.push(`"${onEventName}": `);
    }

    if (prop.exp) {
      genEventHandler(prop.exp, context);
    } else {
      context.push("() => {}");
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
    context.push(`"${propName}": `);
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

  context.push(`"${merge.name}": _${helper}([`);
  for (const [i, part] of merge.parts.entries()) {
    if (i > 0) context.push(", ");
    if (part.type === NodeTypes.ATTRIBUTE) {
      context.push(part.value ? JSON.stringify(part.value.content) : '""');
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
      context.push(`[${JSON.stringify(prefix)} + (`);
      genExpressionAsValue(prop.arg, context);
      context.push(`)${suffix ? ` + ${JSON.stringify(suffix)}` : ""}]: `);
    } else {
      context.push(`"${prefix}${staticName}${suffix}": `);
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
      context.push(`"${staticName === "modelValue" ? "model" : staticName}Modifiers": `);
    }
    context.push("{");
    for (const [i, mod] of prop.modifiers.entries()) {
      if (i > 0) context.push(", ");
      const modName = typeof mod === "string" ? mod : (mod as SimpleExpressionNode).content;
      context.push(`${JSON.stringify(modName)}: true`);
    }
    context.push("}");
  }
}

function genPropsObjectBody(
  props: (AttributeNode | DirectiveNode)[],
  context: CodegenContext,
  withScopeId: boolean,
  expandVModel: boolean,
): void {
  context.push("{");
  let first = true;

  if (withScopeId && context.scopeId) {
    context.push(`"${context.scopeId}": ""`);
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

      context.push(`"${prop.name}": `);
      if (prop.value) {
        context.push(JSON.stringify(prop.value.content));
      } else {
        context.push("true");
      }
    } else if (prop.type === NodeTypes.DIRECTIVE) {
      if (expandVModel && prop.name === "model" && prop.exp) {
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

function genPropsObjectWithScopeId(
  props: (AttributeNode | DirectiveNode)[],
  context: CodegenContext,
): void {
  genPropsObjectBody(props, context, true, false);
}

function genPropsObject(props: (AttributeNode | DirectiveNode)[], context: CodegenContext): void {
  genPropsObjectBody(props, context, false, true);
}
