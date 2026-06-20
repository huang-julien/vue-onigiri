import {
  type ExpressionNode,
  type ForNode,
  type IfNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-dom";
import { VServerComponentType } from "../../runtime/shared";
import type { CodegenContext } from "./context";
import { withoutRenderlessChildren, genNode } from "./vnode";
import { collectBindingNames, genExpressionAsValue } from "./expressions";

function genChildrenAsNodeOrFragment(
  children: Array<IfNode["branches"][number]["children"][number]>,
  context: CodegenContext,
): void {
  // Comments emit no code. Filtering first avoids a comment-only branch
  // producing `cond ?  : null` / `(x) => ` (syntax errors) and a comment
  // between siblings leaving a sparse-array hole.
  const renderable = withoutRenderlessChildren(children);

  if (renderable.length === 1 && renderable[0]?.type !== NodeTypes.FOR) {
    genNode(renderable[0], context);
    return;
  }

  context.push("[");
  context.push(VServerComponentType.Fragment.toString());
  context.push(", [");
  for (let i = 0; i < renderable.length; i++) {
    if (i > 0) context.push(", ");
    genNode(renderable[i], context);
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

  // A destructured value (`{ id, name } in items`) reaches codegen as a
  // COMPOUND_EXPRESSION (transformExpression rewrites it), so `.content`
  // is undefined. Fall back to the original source text from `loc`.
  const valueVar = (value as SimpleExpressionNode)?.content || value?.loc?.source?.trim() || "item";
  // The value may be a destructuring pattern (`{ id, name }`, `[a, b]`),
  // so register the names it binds, not the raw pattern text.
  const loopVars: string[] = collectBindingNames(valueVar);
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

  // Only remove the names this loop actually added. A nested v-for that
  // shadows an outer binding (`v-for="item in item.children"`) must not
  // strip the outer loop's entry when the inner one closes.
  const added: string[] = [];
  for (const v of loopVars) {
    if (!context.localVars.has(v)) {
      context.localVars.add(v);
      added.push(v);
    }
  }

  try {
    genChildrenAsNodeOrFragment(node.children, context);
  } finally {
    for (const v of added) {
      context.localVars.delete(v);
    }
  }

  context.push("))");
}
