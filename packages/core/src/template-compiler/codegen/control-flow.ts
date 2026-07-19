import { type ForNode, type IfNode, type SimpleExpressionNode, NodeTypes } from "@vue/compiler-dom";
import { genImport } from "knitwork";
import { VServerComponentType } from "../../runtime/shared";
import type { CodegenContext } from "./context";
import { withoutRenderlessChildren, genNode } from "./vnode";
import { collectBindingNames, genExpressionAsValue } from "./expressions";

function genChildrenAsNodeOrFragment(
  children: Array<IfNode["branches"][number]["children"][number]>,
  context: CodegenContext,
): void {
  // Comments emit no code; filter first so a comment-only branch (`cond ?  : null`) or a comment between siblings cannot produce invalid JS.
  const renderable = withoutRenderlessChildren(children);

  if (renderable.length === 1 && renderable[0]?.type !== NodeTypes.FOR) {
    genNode(renderable[0], context);
    return;
  }

  context.push("[");
  context.push(VServerComponentType.Fragment.toString());
  context.push(", [");
  for (const [i, element_] of renderable.entries()) {
    if (i > 0) context.push(", ");
    genNode(element_, context);
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

/**
 * v-for compiles to `...(_renderList(source, (value, key, index) => ...))`.
 * `renderList` matches Vue's iteration semantics for arrays, objects, numbers, strings and iterables.
 * The spread relies on v-for only appearing where the parent is an array of VServerComponents.
 */
export function genFor(node: ForNode, context: CodegenContext): void {
  const { source, value, key, index } = node.parseResult;

  // A destructured value (`{ id, name } in items`) becomes a COMPOUND_EXPRESSION with no `.content`; fall back to `loc` source.
  const valueVar = (value as SimpleExpressionNode)?.content || value?.loc?.source?.trim() || "item";
  // Register the names a destructuring pattern binds, not the raw pattern text.
  const loopVars: string[] = collectBindingNames(valueVar);
  if (key) {
    loopVars.push((key as SimpleExpressionNode).content);
  }
  if (index) {
    loopVars.push((index as SimpleExpressionNode).content);
  }

  context.imports.add(genImport("vue", [{ name: "renderList", as: "_renderList" }]));

  context.push("...(_renderList(");
  genExpressionAsValue(source, context);
  context.push(", (");
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

  // Only delete names this loop added, so a shadowing nested v-for (`item in item.children`) keeps the outer entry alive.
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
