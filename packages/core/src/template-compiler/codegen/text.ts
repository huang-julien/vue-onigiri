import {
  type CompoundExpressionNode,
  type InterpolationNode,
  type SimpleExpressionNode,
  type TextNode,
  NodeTypes,
} from "@vue/compiler-dom";
import { VServerComponentType } from "../../runtime/shared";
import type { CodegenContext } from "./context";
import { genNode } from "./vnode";
import { genExpressionAsValue } from "./expressions";

export function genText(node: TextNode, context: CodegenContext): void {
  context.push("[");
  context.push(VServerComponentType.Text.toString());
  context.push(", ");
  context.push(JSON.stringify(node.content));
  context.push("]");
}

export function genInterpolation(node: InterpolationNode, context: CodegenContext): void {
  context.push("[");
  context.push(VServerComponentType.Text.toString());
  context.push(", ");
  genExpressionAsValue(node.content, context);
  context.push("]");
}

export function genCompoundExpression(node: CompoundExpressionNode, context: CodegenContext): void {
  context.push("[");
  context.push(VServerComponentType.Text.toString());
  context.push(", ");
  context.push("(");

  for (const child of node.children) {
    if (typeof child === "string") {
      context.push(child);
    } else if (typeof child === "symbol") {
      continue;
    } else if (child && typeof child === "object" && "type" in child) {
      switch (child.type) {
        case NodeTypes.TEXT: {
          context.push(JSON.stringify((child as TextNode).content));
          break;
        }
        case NodeTypes.INTERPOLATION: {
          genExpressionAsValue((child as InterpolationNode).content, context);
          break;
        }
        case NodeTypes.SIMPLE_EXPRESSION: {
          context.push((child as SimpleExpressionNode).content);
          break;
        }
        case NodeTypes.COMPOUND_EXPRESSION: {
          context.push("(");
          for (const innerChild of (child as CompoundExpressionNode).children) {
            if (typeof innerChild === "string") {
              context.push(innerChild);
            } else if (innerChild && typeof innerChild === "object" && "type" in innerChild) {
              if (innerChild.type === NodeTypes.TEXT) {
                context.push(JSON.stringify((innerChild as TextNode).content));
              } else if (innerChild.type === NodeTypes.SIMPLE_EXPRESSION) {
                context.push((innerChild as SimpleExpressionNode).content);
              }
            }
          }
          context.push(")");
          break;
        }
      }
    }
  }

  context.push(")");
  context.push("]");
}

export function genTextCall(node: any, context: CodegenContext): void {
  if (node.content) {
    genNode(node.content, context);
  } else {
    context.push("null");
  }
}
