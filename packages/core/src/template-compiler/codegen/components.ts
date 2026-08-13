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
import { withoutRenderlessChildren, genFragment, genNodeList } from "./vnode";
import { genExpressionAsValue, prefixIdentifiers } from "./expressions";
import { genProps } from "./props";
import { findSlotDirective, genSlotsObject, slotDirectiveName } from "./slots";
import { tagCasings } from "./tag-casings";

export function getComponentRef(tag: string, context: CodegenContext): string {
  const pascalName = tag
    .replace(/-./g, (x) => x[1]?.toUpperCase() ?? "")
    .replace(/^./, (x) => x.toUpperCase());
  const camelName = pascalName.replace(/^./, (x) => x.toLowerCase());
  const kebabName = tag.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase();

  const isImported
    = context.bindingMetadata[tag]
      || context.bindingMetadata[pascalName]
      || context.bindingMetadata[camelName];

  if (isImported) {
    return context.bindingMetadata[tag]
      ? tag
      : (context.bindingMetadata[pascalName]
          ? pascalName
          : camelName);
  }

  const additionalEntry
    = context.additionalImports.get(tag)
      ?? context.additionalImports.get(pascalName)
      ?? context.additionalImports.get(camelName)
      ?? context.additionalImports.get(kebabName);
  if (additionalEntry) {
    const exportName = additionalEntry.export ?? "default";
    const importedName
      = "__onigiri_imported_"
        + pascalName.replace(/[^a-zA-Z0-9_$]/g, "_")
        + (exportName === "default" ? "" : "_" + exportName.replace(/[^a-zA-Z0-9_$]/g, "_"));
    context.imports.add(genImport(additionalEntry.path, [{ name: exportName, as: importedName }]));
    return importedName;
  }

  // Vue allows dotted tags (`<Calendar.Root />`), so sanitise every invalid
  // identifier char; the original tag is still what resolves at runtime.
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

  // Built-ins are never routed through the server-rendered / client-loaded paths.
  if (tag === "Suspense") {
    genSuspense(children, context);
    return;
  }
  if (tag === "component") {
    genDynamicComponent(node, context);
    return;
  }
  if (tag === "Teleport" || tag === "teleport") {
    genTeleport(node, context);
    return;
  }
  // KeepAlive / Transition have no server-side DOM effect; pass children through.
  if (
    tag === "KeepAlive"
    || tag === "keep-alive"
    || tag === "Transition"
    || tag === "transition"
    || tag === "TransitionGroup"
    || tag === "transition-group"
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
 * Generate `[Suspense, [...content], [...fallback]?]`.
 * `<template #fallback>` rides as the optional third tuple element so the client `<Suspense>` can show it while islands resolve.
 */
function genSuspense(children: any[], context: CodegenContext): void {
  const defaultChildren: any[] = [];
  const fallbackChildren: any[] = [];

  // Unlike `parseSlots`, every `<template>` is unwrapped here, even one without
  // a `v-slot`, so its contents land in the content bucket rather than rendering
  // a literal `<template>` element.
  for (const child of children) {
    if (child.type === NodeTypes.ELEMENT && child.tag === "template") {
      const slotName = slotDirectiveName(findSlotDirective(child));
      (slotName === "fallback" ? fallbackChildren : defaultChildren).push(
        ...(child.children ?? []),
      );
      continue;
    }
    defaultChildren.push(child);
  }

  context.push("[");
  context.push(VServerComponentType.Suspense.toString());
  context.push(", ");
  genNodeList(withoutRenderlessChildren(defaultChildren), context);

  const fallback = withoutRenderlessChildren(fallbackChildren);
  if (fallback.length > 0) {
    context.push(", ");
    genNodeList(fallback, context);
  }

  context.push("]");
}

/** Generate `[Teleport, target, disabled, [...children]]` so the client re-creates a real `<Teleport>`. */
function genTeleport(node: ElementNode, context: CodegenContext): void {
  const { props, children } = node;

  const findProp = (name: string) =>
    props.find(
      (p) =>
        (p.type === NodeTypes.ATTRIBUTE && p.name === name)
        || (p.type === NodeTypes.DIRECTIVE
          && p.name === "bind"
          && p.arg?.type === NodeTypes.SIMPLE_EXPRESSION
          && p.arg.content === name),
    );

  context.push("[");
  context.push(VServerComponentType.Teleport.toString());
  context.push(", ");

  const to = findProp("to");
  if (to?.type === NodeTypes.ATTRIBUTE && to.value) {
    context.push(JSON.stringify(to.value.content));
  } else if (to?.type === NodeTypes.DIRECTIVE && to.exp) {
    genExpressionAsValue(to.exp, context);
  } else {
    context.push("undefined");
  }
  context.push(", ");

  const disabled = findProp("disabled");
  if (disabled?.type === NodeTypes.ATTRIBUTE) {
    context.push("true");
  } else if (disabled?.type === NodeTypes.DIRECTIVE && disabled.exp) {
    genExpressionAsValue(disabled.exp, context);
  } else {
    context.push("undefined");
  }
  context.push(", ");

  genNodeList(withoutRenderlessChildren(children), context);
  context.push("]");
}

function genFragmentPassthrough(children: any[], context: CodegenContext): void {
  genFragment(withoutRenderlessChildren(children), context);
}

/**
 * Generate code for `<component :is="...">`. The resolved target is
 * serialized inline on the server, just like a regular component.
 */
function genDynamicComponent(node: ElementNode, context: CodegenContext): void {
  const { props, children } = node;

  const isAttr = props.find(
    (p) =>
      (p.type === NodeTypes.ATTRIBUTE && p.name === "is")
      || (p.type === NodeTypes.DIRECTIVE
        && p.name === "bind"
        && p.arg
        && (p.arg as SimpleExpressionNode).content === "is"),
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
      !(p.type === NodeTypes.ATTRIBUTE && p.name === "is")
      && !(
        p.type === NodeTypes.DIRECTIVE
        && p.name === "bind"
        && p.arg
        && (p.arg as SimpleExpressionNode).content === "is"
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
 * v-load-client component; the target must resolve at compile time from
 * static imports or `additionalImports`, anything else is a compile error.
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
 * Resolve a v-load-client target to a root-relative path without pulling
 * it into the SSR bundle: importMap and additionalImports are checked
 * under all tag casings, and neither resolving is a compile error.
 */
function resolveClientChunkPath(tag: string, context: CodegenContext): string {
  const casings = tagCasings(tag);
  for (const key of casings) {
    const fromImportMap = context.importMap.get(key);
    if (fromImportMap) return fromImportMap;
    const fromAdditional = context.additionalImports.get(key);
    if (fromAdditional) return fromAdditional.path;
  }

  const pascal = casings[1];
  throw new Error(
    `[vue-onigiri] Cannot resolve v-load-client target "${tag}": no matching import in `
    + `the component's <script> block and no entry in additionalImports. `
    + `Either import the component statically (\`import ${pascal} from './path/to/${pascal}.vue'\`), `
    + `or pass it through the compiler plugin's \`additionalImports\` option.`,
  );
}

/**
 * Resolve the export name for a v-load-client chunk, mirroring the
 * multi-casing lookup of `resolveClientChunkPath`. Only additionalImports
 * entries carry an explicit export; everything else is "default".
 */
function resolveClientChunkExport(tag: string, context: CodegenContext): string {
  for (const key of tagCasings(tag)) {
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
  // Registered so the manifest plugin can emit a precise import.meta.glob.
  context.registerTarget?.(sourcePath);
  // The source path is a valid descriptor (the runtime importFn resolves
  // it via the manifest glob); resolveChunkUrl optionally bakes a URL instead.
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
