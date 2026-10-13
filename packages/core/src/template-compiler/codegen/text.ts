import {
  type CompoundExpressionNode,
  type InterpolationNode,
  type SimpleExpressionNode,
  type TextNode,
  NodeTypes,
} from "@vue/compiler-dom";
import { genImport, genString } from "knitwork";
import { VServerComponentType } from "../../runtime/shared";
import type { CodegenContext } from "./context";
import { genNode, TEXT_CALL } from "./vnode";
import { genExpressionAsValue } from "./expressions";

function pushDisplayString(context: CodegenContext, genExpr: () => void): void {
  context.imports.add(genImport("vue", [{ name: "toDisplayString", as: "_toDisplayString" }]));
  context.push("_toDisplayString(");
  genExpr();
  context.push(")");
}

type TextLikeNode = TextNode | InterpolationNode | CompoundExpressionNode;

/** The text-like node behind `node`, unwrapping a TEXT_CALL; undefined for anything else. */
export function textLikeNode(node: any): TextLikeNode | undefined {
  const inner = node?.type === TEXT_CALL ? node.content : node;
  switch (inner?.type) {
    case NodeTypes.TEXT:
    case NodeTypes.INTERPOLATION:
    case NodeTypes.COMPOUND_EXPRESSION: {
      return inner;
    }
    default: {
      return undefined;
    }
  }
}

/** Emits the string expression of a text-like node without the Text tuple around it. */
export function genTextContent(node: TextLikeNode, context: CodegenContext): void {
  switch (node.type) {
    case NodeTypes.TEXT: {
      context.push(genString(node.content));
      break;
    }
    case NodeTypes.INTERPOLATION: {
      pushDisplayString(context, () => genExpressionAsValue(node.content, context));
      break;
    }
    case NodeTypes.COMPOUND_EXPRESSION: {
      genCompoundContent(node, context);
      break;
    }
  }
}

function genTextTuple(context: CodegenContext, genContent: () => void): void {
  context.push("[");
  context.push(VServerComponentType.Text.toString());
  context.push(", ");
  genContent();
  context.push("]");
}

export function genText(node: TextNode, context: CodegenContext): void {
  genTextTuple(context, () => genTextContent(node, context));
}

export function genInterpolation(node: InterpolationNode, context: CodegenContext): void {
  genTextTuple(context, () => genTextContent(node, context));
}

export function genCompoundExpression(node: CompoundExpressionNode, context: CodegenContext): void {
  genTextTuple(context, () => genCompoundContent(node, context));
}

function genCompoundContent(node: CompoundExpressionNode, context: CodegenContext): void {
  context.push("(");

  for (const child of node.children) {
    if (typeof child === "string") {
      context.push(child);
    } else if (typeof child === "symbol") {
      continue;
    } else if (child && typeof child === "object" && "type" in child) {
      switch (child.type) {
        case NodeTypes.TEXT: {
          context.push(genString((child as TextNode).content));
          break;
        }
        case NodeTypes.INTERPOLATION: {
          pushDisplayString(context, () =>
            genExpressionAsValue((child as InterpolationNode).content, context),
          );
          break;
        }
        case NodeTypes.SIMPLE_EXPRESSION: {
          pushDisplayString(context, () => context.push((child as SimpleExpressionNode).content));
          break;
        }
        case NodeTypes.COMPOUND_EXPRESSION: {
          pushDisplayString(context, () => {
            context.push("(");
            for (const innerChild of (child as CompoundExpressionNode).children) {
              if (typeof innerChild === "string") {
                context.push(innerChild);
              } else if (innerChild && typeof innerChild === "object" && "type" in innerChild) {
                if (innerChild.type === NodeTypes.TEXT) {
                  context.push(genString((innerChild as TextNode).content));
                } else if (innerChild.type === NodeTypes.SIMPLE_EXPRESSION) {
                  context.push((innerChild as SimpleExpressionNode).content);
                }
              }
            }
            context.push(")");
          });
          break;
        }
      }
    }
  }

  context.push(")");
}

export function genTextCall(node: any, context: CodegenContext): void {
  if (node.content) {
    genNode(node.content, context);
  } else {
    context.push("null");
  }
}
