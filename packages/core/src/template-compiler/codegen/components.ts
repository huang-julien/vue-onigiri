import {
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-dom";
import { genImport } from "knitwork";
import { VServerComponentType } from "../../runtime/shared";
import type { CodegenContext } from "./context";
import { genNode } from "./vnode";
import { genExpressionAsValue, prefixIdentifiers } from "./expressions";
import { genProps } from "./props";
import { genSlotsObject } from "./slots";

/**
 * Resolve a tag to a usable identifier — either an imported binding or a
 * `_component_*` variable backed by `resolveComponent()` at runtime.
 */
export function getComponentRef(tag: string, context: CodegenContext): string {
  const pascalName = tag
    .replace(/-./g, (x) => x[1]?.toUpperCase() ?? "")
    .replace(/^./, (x) => x.toUpperCase());
  const camelName = pascalName.replace(/^./, (x) => x.toLowerCase());

  const isImported =
    context.bindingMetadata[tag] ||
    context.bindingMetadata[pascalName] ||
    context.bindingMetadata[camelName];

  if (isImported) {
    return context.bindingMetadata[tag]
      ? tag
      : context.bindingMetadata[pascalName]
        ? pascalName
        : camelName;
  }

  const varName = "_component_" + tag.replace(/-/g, "_");

  if (!context.components.has(tag)) {
    context.components.set(tag, varName);
    context.imports.add(
      genImport("vue-onigiri/runtime/resolve-component", [
        { name: "resolveComponentInInstance", as: "__onigiri_resolveComponent" },
      ]),
    );
  }

  return varName;
}

export function genComponent(node: ElementNode, context: CodegenContext): void {
  const { tag, props, children } = node;

  // Built-ins — never routed through the server-rendered / client-loaded paths.
  if (tag === "Suspense") {
    genSuspense(children, context);
    return;
  }
  if (tag === "component") {
    genDynamicComponent(node, context);
    return;
  }
  // Teleport / KeepAlive / Transition have no server-side DOM effect — pass
  // children through as a fragment.
  if (
    tag === "Teleport" ||
    tag === "teleport" ||
    tag === "KeepAlive" ||
    tag === "keep-alive" ||
    tag === "Transition" ||
    tag === "transition" ||
    tag === "TransitionGroup" ||
    tag === "transition-group"
  ) {
    genFragmentPassthrough(children, context);
    return;
  }

  const loadClientDirective = props.find(
    (p): p is DirectiveNode => p.type === NodeTypes.DIRECTIVE && p.name === "load-client",
  );

  if (loadClientDirective) {
    if (loadClientDirective.exp) {
      genDynamicLoadClientComponent(tag, props, children, loadClientDirective, context);
    } else {
      genClientLoadedComponent(tag, props, children, context);
    }
  } else {
    genServerRenderedComponent(tag, props, children, context);
  }
}

/**
 * Generate `[Suspense, [...children]]`. Vue's Suspense treats the default
 * slot as its content by convention, so we flatten non-template children
 * and `<template #default>` content into one array.
 */
function genSuspense(children: any[], context: CodegenContext): void {
  context.push("[");
  context.push(VServerComponentType.Suspense.toString());
  context.push(", [");
  const filtered = children.filter((c) => c.type !== NodeTypes.ELEMENT || c.tag !== "template");
  const defaultSlotChildren = children
    .filter((c) => c.type === NodeTypes.ELEMENT && c.tag === "template")
    .flatMap((c) => c.children ?? []);
  const all = [...filtered, ...defaultSlotChildren];
  for (const [i, child] of all.entries()) {
    if (i > 0) context.push(", ");
    genNode(child, context);
  }
  context.push("]]");
}

function genFragmentPassthrough(children: any[], context: CodegenContext): void {
  context.push("[");
  context.push(VServerComponentType.Fragment.toString());
  context.push(", [");
  for (const [i, child] of children.entries()) {
    if (i > 0) context.push(", ");
    genNode(child, context);
  }
  context.push("]]");
}

/**
 * Generate code for `<component :is="...">`. The resolved target is
 * serialized inline on the server, just like a regular component.
 */
function genDynamicComponent(node: ElementNode, context: CodegenContext): void {
  const { props, children } = node;

  const isAttr = props.find(
    (p) =>
      (p.type === NodeTypes.ATTRIBUTE && p.name === "is") ||
      (p.type === NodeTypes.DIRECTIVE &&
        p.name === "bind" &&
        p.arg &&
        (p.arg as SimpleExpressionNode).content === "is"),
  );

  let targetExpr = "null";
  if (isAttr?.type === NodeTypes.ATTRIBUTE && isAttr.value) {
    const tagName = isAttr.value.content;
    targetExpr = getComponentRef(tagName, context);
  } else if (isAttr?.type === NodeTypes.DIRECTIVE && isAttr.exp) {
    context.imports.add(
      genImport("vue-onigiri/runtime/resolve-component", [
        { name: "resolveDynamicComponentInInstance", as: "__onigiri_resolveDynamicComponent" },
      ]),
    );
    const exp = isAttr.exp as SimpleExpressionNode;
    const rawExpr = exp.content ?? exp.loc?.source ?? "";
    const expContent = prefixIdentifiers(rawExpr, context.bindingMetadata, context.localVars);
    targetExpr = `__onigiri_resolveDynamicComponent(__instance, ${expContent})`;
  }

  context.imports.add(
    genImport("vue-onigiri/runtime/serialize", [
      { name: "serializeComponentInContext", as: "__serializeComponentInContext" },
    ]),
  );

  context.push(`__serializeComponentInContext(${targetExpr}, `);

  const propsWithoutIs = props.filter(
    (p) =>
      !(p.type === NodeTypes.ATTRIBUTE && p.name === "is") &&
      !(
        p.type === NodeTypes.DIRECTIVE &&
        p.name === "bind" &&
        p.arg &&
        (p.arg as SimpleExpressionNode).content === "is"
      ),
  );
  if (propsWithoutIs.length > 0) {
    genProps(propsWithoutIs, context);
  } else {
    context.push("undefined");
  }
  context.push(", __instance, ");
  genSlotsObject(children, context, true);
  context.push(")");
}

/**
 * Emit a `[Component, props, chunkPath, exportName, slots]` payload for a
 * `v-load-client` component. The path must be resolvable at compile time —
 * either via the SFC's own static imports or via `additionalImports` (Nuxt
 * components registry, globally-registered components declared by the user).
 * Anything else is a hard compile error.
 */
function genClientLoadedComponent(
  tag: string,
  props: (AttributeNode | DirectiveNode)[],
  children: any[],
  context: CodegenContext,
): void {
  const componentRef = getComponentRef(tag, context);
  const staticSource = resolveClientChunkPath(tag, componentRef, context);

  context.push("[");
  context.push(VServerComponentType.Component.toString());
  context.push(", ");

  const propsWithoutLoadClient = props.filter(
    (p) => !(p.type === NodeTypes.DIRECTIVE && p.name === "load-client"),
  );
  if (propsWithoutLoadClient.length > 0) {
    genProps(propsWithoutLoadClient, context);
  } else {
    context.push("undefined");
  }
  context.push(", ");

  context.push(JSON.stringify(staticSource));
  context.push(', "default", ');

  genSlotsObject(children, context, false);

  context.push("]");
}

/**
 * Resolve a `v-load-client` target to a root-relative module path. Tries the
 * SFC's static imports keyed by the resolved ref first, then external
 * `additionalImports` under Pascal / camel / kebab variants of the tag.
 */
function resolveClientChunkPath(
  tag: string,
  componentRef: string,
  context: CodegenContext,
): string {
  const fromImportMap = context.importMap.get(componentRef);
  if (fromImportMap) return fromImportMap;

  const pascal = tag
    .replace(/-./g, (x) => x[1]?.toUpperCase() ?? "")
    .replace(/^./, (x) => x.toUpperCase());
  const camel = pascal.replace(/^./, (x) => x.toLowerCase());
  const kebab = tag.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase();
  for (const key of [tag, pascal, camel, kebab]) {
    const path = context.additionalImports.get(key);
    if (path) return path;
  }

  throw new Error(
    `[vue-onigiri] Cannot resolve v-load-client target "${tag}": no matching import in ` +
      `the component's <script> block and no entry in additionalImports. ` +
      `Either import the component statically (\`import ${pascal} from './path/to/${pascal}.vue'\`), ` +
      `or pass it through the compiler plugin's \`additionalImports\` option.`,
  );
}

/**
 * Emit `__serializeComponentInContext(...)` so the child renders server-side
 * and its output is inlined into the parent's payload.
 */
function genServerRenderedComponent(
  tag: string,
  props: (AttributeNode | DirectiveNode)[],
  children: any[],
  context: CodegenContext,
): void {
  const componentRef = getComponentRef(tag, context);

  context.imports.add(
    genImport("vue-onigiri/runtime/serialize", [
      { name: "serializeComponentInContext", as: "__serializeComponentInContext" },
    ]),
  );

  context.push(`__serializeComponentInContext(${componentRef}, `);

  if (props.length > 0) {
    genProps(props, context);
  } else {
    context.push("undefined");
  }

  context.push(", __instance, ");

  genSlotsObject(children, context, true);

  context.push(")");
}

function genDynamicLoadClientComponent(
  tag: string,
  props: (AttributeNode | DirectiveNode)[],
  children: any[],
  loadClientDirective: DirectiveNode,
  context: CodegenContext,
): void {
  const componentRef = getComponentRef(tag, context);
  const chunkPath = resolveClientChunkPath(tag, componentRef, context);

  context.imports.add(
    genImport("vue-onigiri/runtime/serialize", [
      { name: "serializeChildComponent", as: "__serializeChildComponent" },
    ]),
  );

  context.push(`__serializeChildComponent(${componentRef}, `);

  const propsWithoutLoadClient = props.filter(
    (p) => !(p.type === NodeTypes.DIRECTIVE && p.name === "load-client"),
  );
  if (propsWithoutLoadClient.length > 0) {
    genProps(propsWithoutLoadClient, context);
  } else {
    context.push("undefined");
  }
  context.push(", __instance, ");

  genExpressionAsValue(loadClientDirective.exp!, context);
  context.push(", ");

  genSlotsObject(children, context, false);

  context.push(", ");
  context.push(JSON.stringify(chunkPath));
  context.push(', "default"');

  context.push(")");
}
