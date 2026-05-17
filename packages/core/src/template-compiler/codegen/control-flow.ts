import {
  type ExpressionNode,
  type ForNode,
  type IfNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-dom";
import { VServerComponentType } from "../../runtime/shared";
import type { CodegenContext } from "./context";
import { genNode } from "./vnode";
import { genExpressionAsValue } from "./expressions";

function genChildrenAsNodeOrFragment(
  children: Array<IfNode["branches"][number]["children"][number]>,
  context: CodegenContext,
): void {
  if (children.length === 1 && children[0]?.type !== NodeTypes.FOR) {
    genNode(children[0], context);
    return;
  }

  context.push("[");
  context.push(VServerComponentType.Fragment.toString());
  context.push(", [");
  for (let i = 0; i < children.length; i++) {
    if (i > 0) context.push(", ");
    genNode(children[i], context);
  }
  context.push("]]");
}

/** v-if / v-else-if / v-else compiled to a chain of ternaries. */
export function genIf(node: IfNode, context: CodegenContext): void {
  const firstBranch = node.branches[0];
  if (!firstBranch) {
    context.push("null");
    return;
  }

  context.push("(");
  if (firstBranch.condition) {
    genExpressionAsValue(firstBranch.condition, context);
  } else {
    context.push("true");
  }

  context.push(" ? ");
  genChildrenAsNodeOrFragment(firstBranch.children, context);

  context.push(" : ");

  if (node.branches.length > 1 && node.branches[1]) {
    const elseBranch = node.branches[1];
    if (elseBranch.condition) {
      const newIfNode = { ...node, branches: node.branches.slice(1) };
      genIf(newIfNode, context);
    } else {
      genChildrenAsNodeOrFragment(elseBranch.children, context);
    }
  } else {
    context.push("null");
  }

  context.push(")");
}

function isNumericLiteral(node: ExpressionNode | undefined): boolean {
  if (!node) return false;
  if (node.type === NodeTypes.SIMPLE_EXPRESSION) {
    const content = (node as SimpleExpressionNode).content.trim();
    return /^-?\d+(\.\d+)?$/.test(content);
  }
  return false;
}

/**
 * v-for compiled to `...(source.map(...))`. The spread relies on v-for
 * only appearing in child positions where the parent is an array of
 * VServerComponents (element children, fragment children, slot bodies).
 */
export function genFor(node: ForNode, context: CodegenContext): void {
  const { source, value, key, index } = node.parseResult;

  const loopVars: string[] = [];
  const valueVar = (value as SimpleExpressionNode)?.content || "item";
  loopVars.push(valueVar);
  if (key) {
    loopVars.push((key as SimpleExpressionNode).content);
  }
  if (index) {
    loopVars.push((index as SimpleExpressionNode).content);
  }

  const isNumeric = isNumericLiteral(source);

  context.push("...(");
  if (isNumeric) {
    // `v-for="n in 3"` iterates 1..n inclusive — match Vue's semantics.
    context.push("Array.from({length: ");
    genExpressionAsValue(source, context);
    context.push("}, (_, __i) => __i + 1)");
  } else {
    genExpressionAsValue(source, context);
  }
  context.push(".map((");
  context.push(valueVar);
  if (key) {
    context.push(", ");
    context.push((key as SimpleExpressionNode).content);
  }
  if (index) {
    context.push(", ");
    context.push((index as SimpleExpressionNode).content);
  }
  context.push(") => ");

  for (const v of loopVars) {
    context.localVars.add(v);
  }

  try {
    genChildrenAsNodeOrFragment(node.children, context);
  } finally {
    for (const v of loopVars) {
      context.localVars.delete(v);
    }
  }

  context.push("))");
}
