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

function genPropsObjectWithScopeId(
  props: (AttributeNode | DirectiveNode)[],
  context: CodegenContext,
): void {
  context.push("{");
  let first = true;

  if (context.scopeId) {
    context.push(`"${context.scopeId}": ""`);
    first = false;
  }

  for (const prop of props) {
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
      if (STRIPPED_DIRECTIVES.has(prop.name)) continue;
      if (shouldWrapDirective(prop.name)) continue;

      if (!first) context.push(", ");
      first = false;

      if (prop.name === "on") {
        const eventName =
          prop.arg && typeof prop.arg === "object" && "content" in prop.arg
            ? (prop.arg as SimpleExpressionNode).content
            : "";
        const onEventName = "on" + eventName.charAt(0).toUpperCase() + eventName.slice(1);
        context.push(`"${onEventName}": `);

        if (prop.exp) {
          genEventHandler(prop.exp, context);
        } else {
          context.push("() => {}");
        }
        continue;
      }

      if (prop.name === "bind" && prop.arg) {
        const propName =
          prop.arg && typeof prop.arg === "object" && "content" in prop.arg
            ? (prop.arg as SimpleExpressionNode).content
            : "";
        context.push(`"${propName}": `);

        if (prop.exp) {
          genExpressionAsValue(prop.exp, context);
        } else {
          context.push("true");
        }
        continue;
      }
    }
  }

  context.push("}");
}

function genPropsObject(props: (AttributeNode | DirectiveNode)[], context: CodegenContext): void {
  context.push("{");
  let first = true;

  for (const prop of props) {
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
      if (STRIPPED_DIRECTIVES.has(prop.name)) continue;
      if (shouldWrapDirective(prop.name)) continue;

      if (!first) context.push(", ");
      first = false;

      if (prop.name === "on") {
        const eventName =
          prop.arg && typeof prop.arg === "object" && "content" in prop.arg
            ? (prop.arg as SimpleExpressionNode).content
            : "";
        const onEventName = "on" + eventName.charAt(0).toUpperCase() + eventName.slice(1);
        context.push(`"${onEventName}": `);

        if (prop.exp) {
          genEventHandler(prop.exp, context);
        } else {
          context.push("() => {}");
        }
        continue;
      }

      if (prop.name === "bind" && prop.arg) {
        const attrName =
          typeof prop.arg === "object" && "content" in prop.arg
            ? (prop.arg as SimpleExpressionNode).content
            : "";
        context.push(`"${attrName}": `);

        if (prop.exp) {
          genExpressionAsValue(prop.exp, context);
        } else {
          context.push("true");
        }
        continue;
      }
    }
  }

  context.push("}");
}
