import { ElementTypes, Namespaces, NodeTypes, type TemplateChildNode } from "@vue/compiler-dom";
import {
  escapeHtml,
  isKnownHtmlAttr,
  isKnownMathMLAttr,
  isKnownSvgAttr,
  isVoidTag,
} from "@vue/shared";
import type { CodegenContext } from "./context";

// Vue's stringifyStatic excludes table parts with strict parsing parent requirements; script and style are raw-text.
const NON_STRINGIFIABLE_TAGS = new Set([
  "caption",
  "thead",
  "tr",
  "th",
  "tbody",
  "td",
  "tfoot",
  "colgroup",
  "col",
  "script",
  "style",
]);

/** Decide whether a node and its descendants are static and safe to stringify. */
export function isStaticNode(node: TemplateChildNode, context: CodegenContext): boolean {
  if (context.staticDisabled > 0) return false;

  switch (node.type) {
    case NodeTypes.TEXT_CALL:
      return isStaticNode(node.content, context);
    case NodeTypes.TEXT:
    case NodeTypes.COMMENT:
      return true;
    case NodeTypes.ELEMENT:
      return (
        node.tagType === ElementTypes.ELEMENT &&
        !context.isCustomElement(node.tag) &&
        !NON_STRINGIFIABLE_TAGS.has(node.tag) &&
        node.props.every(
          (prop) =>
            prop.type === NodeTypes.ATTRIBUTE &&
            prop.name !== "key" &&
            prop.name !== "ref" &&
            isStringifiableAttr(prop.name, node.ns),
        ) &&
        node.children.every((child) => isStaticNode(child, context))
      );
    default:
      return false;
  }
}

/** Emit escaped HTML for a static subtree, omitting comments. */
export function stringifyStaticNode(node: TemplateChildNode, context: CodegenContext): string {
  switch (node.type) {
    case NodeTypes.TEXT_CALL:
      return stringifyStaticNode(node.content, context);
    case NodeTypes.TEXT:
      return escapeHtml(node.content);
    case NodeTypes.ELEMENT: {
      let html = `<${node.tag}`;
      for (const prop of node.props) {
        if (prop.type !== NodeTypes.ATTRIBUTE) continue;
        html += ` ${prop.name}`;
        if (prop.value) html += `="${escapeHtml(prop.value.content)}"`;
      }
      if (context.scopeId) html += ` ${context.scopeId}`;
      html += ">";
      for (const child of node.children) html += stringifyStaticNode(child, context);
      if (!isVoidTag(node.tag)) html += `</${node.tag}>`;
      return html;
    }
    default:
      return "";
  }
}

function isStringifiableAttr(name: string, ns: Namespaces): boolean {
  return (
    (ns === Namespaces.HTML
      ? isKnownHtmlAttr(name)
      : ns === Namespaces.SVG
        ? isKnownSvgAttr(name)
        : ns === Namespaces.MATH_ML
          ? isKnownMathMLAttr(name)
          : false) || /^(data|aria)-/.test(name)
  );
}
