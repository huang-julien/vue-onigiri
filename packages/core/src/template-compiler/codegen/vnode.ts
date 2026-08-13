import { NodeTypes } from "@vue/compiler-dom";
import { VServerComponentType } from "../../runtime/shared";
import type { CodegenContext } from "./context";
import { genElement } from "./elements";
import { genIf, genFor } from "./control-flow";
import { genCompoundExpression, genInterpolation, genText, genTextCall } from "./text";

// Internal Vue transform-phase node types not exported by `@vue/compiler-dom`.
const TEXT_CALL = 12;
const VNODE_CALL = 13;
const JS_CALL_EXPRESSION = 14;

export function withoutRenderlessChildren(children: any[]): any[] {
  return children.filter((c) => c?.type !== NodeTypes.COMMENT);
}

export function genNode(node: any, context: CodegenContext): void {
  switch (node.type) {
    case NodeTypes.ELEMENT: {
      genElement(node, context);
      break;
    }
    case NodeTypes.TEXT: {
      genText(node, context);
      break;
    }
    case NodeTypes.INTERPOLATION: {
      genInterpolation(node, context);
      break;
    }
    case NodeTypes.COMPOUND_EXPRESSION: {
      genCompoundExpression(node, context);
      break;
    }
    case NodeTypes.IF: {
      genIf(node, context);
      break;
    }
    case NodeTypes.FOR: {
      genFor(node, context);
      break;
    }
    case NodeTypes.COMMENT: {
      break;
    }
    case TEXT_CALL: {
      genTextCall(node, context);
      break;
    }
    case VNODE_CALL:
    case JS_CALL_EXPRESSION: {
      if (node.tag) {
        genElement(node, context);
      } else {
        context.push("null");
      }
      break;
    }
    default: {
      context.push("null");
    }
  }
}

/** Emit `[a, b, c]`. Callers pass children already filtered by `withoutRenderlessChildren`. */
export function genNodeList(children: any[], context: CodegenContext): void {
  context.push("[");
  for (const [i, child] of children.entries()) {
    if (i > 0) context.push(", ");
    genNode(child, context);
  }
  context.push("]");
}

/** Emit `[Fragment, [...children]]`. Same pre-filtered contract as `genNodeList`. */
export function genFragment(children: any[], context: CodegenContext): void {
  context.push("[");
  context.push(VServerComponentType.Fragment.toString());
  context.push(", ");
  genNodeList(children, context);
  context.push("]");
}

export { genElement } from "./elements";
export { genIf, genFor } from "./control-flow";
export { genCompoundExpression, genInterpolation, genText } from "./text";
export { genProps } from "./props";
