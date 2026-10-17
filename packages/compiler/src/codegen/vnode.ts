import { NodeTypes, type TemplateChildNode } from "@vue/compiler-dom";
import { genString } from "knitwork";
import { VServerComponentType } from "@vue-onigiri/shared";
import type { CodegenContext } from "./context";
import { genElement } from "./elements";
import { genIf, genFor } from "./control-flow";
import { genCompoundExpression, genInterpolation, genText, genTextCall } from "./text";
import { isStaticNode, stringifyStaticNode } from "./static";

// Internal Vue transform-phase node types not exported by `@vue/compiler-dom`.
export const TEXT_CALL = 12;
const VNODE_CALL = 13;
const JS_CALL_EXPRESSION = 14;

export function withoutRenderlessChildren(children: any[]): any[] {
  return children.filter((c) => c?.type !== NodeTypes.COMMENT);
}

export function genNode(node: any, context: CodegenContext): void {
  switch (node.type) {
    case NodeTypes.ELEMENT: {
      if (isStaticNode(node, context)) {
        genStaticRun([node], context);
        return;
      }
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
  const renderable = withoutRenderlessChildren(children);
  for (let i = 0; i < renderable.length;) {
    if (i > 0) context.push(", ");
    const start = i;
    while (i < renderable.length && isStaticNode(renderable[i], context)) i++;
    const run = renderable.slice(start, i);
    if (run.some((child) => child.type === NodeTypes.ELEMENT)) {
      genStaticRun(run, context);
    } else if (run.length > 0) {
      for (const [j, child] of run.entries()) {
        if (j > 0) context.push(", ");
        genNode(child, context);
      }
    } else {
      genNode(renderable[i++], context);
    }
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

function genStaticRun(children: TemplateChildNode[], context: CodegenContext): void {
  const html = children.map((child) => stringifyStaticNode(child, context)).join("");
  // Dropping comments can join adjacent text nodes into a single DOM text node.
  const nodeCount = children.filter(
    (child, index) =>
      child.type === NodeTypes.ELEMENT ||
      index === 0 ||
      children[index - 1]?.type === NodeTypes.ELEMENT,
  ).length;
  context.push(`[${VServerComponentType.StaticHtml.toString()}, ${genString(html)}, ${nodeCount}]`);
}

export { genElement } from "./elements";
export { genIf, genFor } from "./control-flow";
export { genCompoundExpression, genInterpolation, genText } from "./text";
export { genProps } from "./props";
