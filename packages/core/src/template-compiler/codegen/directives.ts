import {
  type AttributeNode,
  type DirectiveNode,
  type ExpressionNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-dom";
import type { CodegenContext } from "./context";
import { genExpressionAsValue } from "./expressions";

/** Structural / client-only directives — never serialized. */
export const STRIPPED_DIRECTIVES = new Set([
  "if",
  "else",
  "else-if",
  "for",
  "slot",
  "once",
  "memo",
  "cloak",
]);

export function shouldWrapDirective(name: string): boolean {
  if (name === "on" || name === "bind") return false;
  if (STRIPPED_DIRECTIVES.has(name)) return false;
  return true;
}

export function extractWrappedDirectives(
  props: (AttributeNode | DirectiveNode)[],
): DirectiveNode[] {
  return props.filter(
    (prop): prop is DirectiveNode =>
      prop.type === NodeTypes.DIRECTIVE && shouldWrapDirective(prop.name),
  );
}

export function filterPropsForSerialization(
  props: (AttributeNode | DirectiveNode)[],
): (AttributeNode | DirectiveNode)[] {
  return props.filter((prop) => {
    if (prop.type === NodeTypes.DIRECTIVE) {
      return !shouldWrapDirective(prop.name);
    }
    return true;
  });
}

export function getDirectiveRef(name: string, context: CodegenContext): string {
  const vName = "v" + name.charAt(0).toUpperCase() + name.slice(1);
  if (context.bindingMetadata?.[vName]) {
    return `_ctx.${vName}`;
  }
  const camelName = "v" + name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (context.bindingMetadata?.[camelName]) {
    return `_ctx.${camelName}`;
  }
  return JSON.stringify(name);
}

export function genDirectiveBinding(dir: DirectiveNode, context: CodegenContext): void {
  context.push("{");

  let first = true;

  if (dir.exp) {
    context.push("\"value\": ");
    genExpressionAsValue(dir.exp, context);
    first = false;
  }

  if (dir.arg) {
    if (!first) context.push(", ");
    context.push("\"arg\": ");
    if (typeof dir.arg === "object" && "isStatic" in dir.arg && dir.arg.isStatic) {
      context.push(JSON.stringify((dir.arg as SimpleExpressionNode).content));
    } else {
      genExpressionAsValue(dir.arg as ExpressionNode, context);
    }
    first = false;
  }

  if (dir.modifiers && dir.modifiers.length > 0) {
    if (!first) context.push(", ");
    context.push("\"modifiers\": {");
    for (let i = 0; i < dir.modifiers.length; i++) {
      if (i > 0) context.push(", ");
      // `DirectiveNode.modifiers` is `SimpleExpressionNode[]` since Vue
      // 3.4, so interpolating a node directly yields `[object Object]`.
      // Read `.content`, tolerating a plain string for older shapes.
      const mod = dir.modifiers[i] as SimpleExpressionNode | string;
      const modName = typeof mod === "string" ? mod : mod.content;
      context.push(`${JSON.stringify(modName)}: true`);
    }
    context.push("}");
  }

  context.push("}");
}
