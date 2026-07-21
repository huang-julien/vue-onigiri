import type { ElementNode } from "@vue/compiler-dom";
import { genImport } from "knitwork";
import { VServerComponentType } from "../../runtime/shared";
import type { CodegenContext } from "./context";
import { withoutRenderlessChildren, genNode } from "./vnode";
import { genComponent } from "./components";
import { genSlotOutlet } from "./slots";
import { genPropsWithScopeId } from "./props";
import {
  extractWrappedDirectives,
  filterPropsForSerialization,
  genDirectiveBinding,
  getDirectiveRef,
} from "./directives";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function genElement(node: ElementNode, context: CodegenContext): void {
  const { tag } = node;

  if (tag === "slot") {
    genSlotOutlet(node, context);
    return;
  }

  if (context.isCustomElement(tag)) {
    genHtmlElement(node, context);
    return;
  }

  const isComponent = /^[A-Z]/.test(tag) || tag.includes("-") || tag === "component";

  if (isComponent) {
    genComponent(node, context);
  } else {
    genHtmlElement(node, context);
  }
}

function genHtmlElement(node: ElementNode, context: CodegenContext): void {
  const { tag, props, children } = node;

  const isVoidElement = VOID_ELEMENTS.has(tag);

  const wrappedDirectives = extractWrappedDirectives(props);
  const filteredProps = filterPropsForSerialization(props);

  if (wrappedDirectives.length > 0) {
    context.imports.add(
      genImport("vue-onigiri/runtime/with-directive", [
        { name: "withDirective", as: "__withDirective" },
      ]),
    );

    // Open `__withDirective(` calls outermost-first; bindings get appended
    // after the element payload below.
    for (let i = wrappedDirectives.length - 1; i >= 0; i--) {
      const dir = wrappedDirectives[i];
      if (!dir) continue;
      context.push("__withDirective(");
      context.push(getDirectiveRef(dir.name, context));
      context.push(", ");
    }
  }

  context.push("[");
  context.push(VServerComponentType.Element.toString());
  context.push(", ");
  context.push(`"${tag}"`);
  context.push(", ");

  const hasScopeId = !!context.scopeId;
  const hasProps = filteredProps.length > 0;

  if (hasProps || hasScopeId) {
    genPropsWithScopeId(filteredProps, context);
  } else {
    context.push("undefined");
  }

  if (!isVoidElement) {
    context.push(", ");
    // Comments emit no code. Filter them so a leading or middle comment
    // doesn't leave a sparse-array hole that JSON turns into a null child.
    const renderableChildren = withoutRenderlessChildren(children);
    if (renderableChildren.length === 0) {
      context.push("undefined");
    } else {
      context.push("[");
      for (const [i, child] of renderableChildren.entries()) {
        if (i > 0) context.push(", ");
        genNode(child, context);
      }
      context.push("]");
    }
  }

  context.push("]");

  if (wrappedDirectives.length > 0) {
    for (const dir of wrappedDirectives) {
      context.push(", ");
      genDirectiveBinding(dir, context);
      context.push(", __instance)");
    }
  }
}
