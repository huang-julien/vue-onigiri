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
import { withoutRenderlessChildren, genNode } from "./vnode";
import { genExpressionAsValue, prefixIdentifiers } from "./expressions";
import { genProps } from "./props";
import { genSlotsObject } from "./slots";

export function getComponentRef(tag: string, context: CodegenContext): string {
  const pascalName = tag
    .replace(/-./g, (x) => x[1]?.toUpperCase() ?? "")
    .replace(/^./, (x) => x.toUpperCase());
  const camelName = pascalName.replace(/^./, (x) => x.toLowerCase());
  const kebabName = tag.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase();

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

  const additionalEntry =
    context.additionalImports.get(tag) ??
    context.additionalImports.get(pascalName) ??
    context.additionalImports.get(camelName) ??
    context.additionalImports.get(kebabName);
  if (additionalEntry) {
    const exportName = additionalEntry.export ?? "default";
    const importedName =
      "__onigiri_imported_" +
      pascalName.replace(/[^a-zA-Z0-9_$]/g, "_") +
      (exportName === "default" ? "" : "_" + exportName.replace(/[^a-zA-Z0-9_$]/g, "_"));
    context.imports.add(genImport(additionalEntry.path, [{ name: exportName, as: importedName }]));
    return importedName;
  }

  // Sanitise every character that isn't a valid JS identifier part — Vue
  // legally allows dotted tags via namespace member-access (e.g.
  // `<Calendar.Root />`), so just stripping hyphens isn't enough.
  // `resolveComponentInInstance` is still called with the original tag
  // (see `context.components.set(tag, varName)` below) — only the local
  // identifier is sanitised here.
  const varName = "_component_" + tag.replace(/[^a-zA-Z0-9_$]/g, "_");

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
  const all = withoutRenderlessChildren([...filtered, ...defaultSlotChildren]);
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
  for (const [i, child] of withoutRenderlessChildren(children).entries()) {
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
  const sourcePath = resolveClientChunkPath(tag, context);
  context.registerTarget?.(sourcePath);
  const staticSource = context.resolveChunkUrl?.(sourcePath) ?? sourcePath;

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

  const exportName = resolveClientChunkExport(tag, context);
  context.push(JSON.stringify(staticSource));
  context.push(", ");
  context.push(JSON.stringify(exportName));
  context.push(", ");

  genSlotsObject(children, context, false);

  context.push("]");
}

/**
 * Resolve a `v-load-client` target to a root-relative module path
 * WITHOUT pulling the component into the SSR bundle. Looks up the
 * tag's various casings (PascalCase / camelCase / kebab-case) in
 * `importMap` (script statics) and `additionalImports` (Nuxt /
 * user-supplied). Throws at compile time if neither resolves —
 * `v-load-client` requires a known compile-time target.
 */
function resolveClientChunkPath(tag: string, context: CodegenContext): string {
  const pascal = tag
    .replace(/-./g, (x) => x[1]?.toUpperCase() ?? "")
    .replace(/^./, (x) => x.toUpperCase());
  const camel = pascal.replace(/^./, (x) => x.toLowerCase());
  const kebab = tag.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase();
  for (const key of [tag, pascal, camel, kebab]) {
    const fromImportMap = context.importMap.get(key);
    if (fromImportMap) return fromImportMap;
    const fromAdditional = context.additionalImports.get(key);
    if (fromAdditional) return fromAdditional.path;
  }

  throw new Error(
    `[vue-onigiri] Cannot resolve v-load-client target "${tag}": no matching import in ` +
      `the component's <script> block and no entry in additionalImports. ` +
      `Either import the component statically (\`import ${pascal} from './path/to/${pascal}.vue'\`), ` +
      `or pass it through the compiler plugin's \`additionalImports\` option.`,
  );
}

/**
 * Resolve the named export to pull off the dynamically-imported chunk
 * for a `v-load-client` target. Mirrors the multi-casing lookup in
 * `resolveClientChunkPath` so that a tag registered as `ComarkRenderer`
 * still resolves when the template wrote `<comark-renderer>`.
 *
 * Only `additionalImports` entries carry an explicit `export`; the
 * script-local `importMap` is path-only (it represents relative `.vue`
 * imports, which are default-exported), so anything that resolves from
 * there falls back to `"default"`. The runtime loader handles the
 * fallback as `mod[exportName] ?? mod.default ?? mod`.
 */
function resolveClientChunkExport(tag: string, context: CodegenContext): string {
  const pascal = tag
    .replace(/-./g, (x) => x[1]?.toUpperCase() ?? "")
    .replace(/^./, (x) => x.toUpperCase());
  const camel = pascal.replace(/^./, (x) => x.toLowerCase());
  const kebab = tag.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase();
  for (const key of [tag, pascal, camel, kebab]) {
    const entry = context.additionalImports.get(key);
    if (entry) return entry.export ?? "default";
  }
  return "default";
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
  const sourcePath = resolveClientChunkPath(tag, context);
  // Auto-detected v-load-client target — registered with the manifest
  // plugin so it can emit a precise `import.meta.glob([...])` covering
  // exactly the files that need to be loadable at runtime.
  context.registerTarget?.(sourcePath);
  // Bake the public chunk URL into the AST when the host can resolve
  // it at compile time. Falls back to the source path otherwise — the
  // runtime loader's `import.meta.glob` then resolves it on the client.
  const chunkPath = context.resolveChunkUrl?.(sourcePath) ?? sourcePath;

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

  const exportName = resolveClientChunkExport(tag, context);
  context.push(", ");
  context.push(JSON.stringify(chunkPath));
  context.push(", ");
  context.push(JSON.stringify(exportName));

  context.push(")");
}
