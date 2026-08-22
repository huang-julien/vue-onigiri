/**
 * Compiles Vue templates to onigiri render functions returning
 * serialized VServerComponent structures.
 */

import {
  baseParse,
  isFnExpression,
  isMemberExpression,
  NodeTypes,
  transform,
  getBaseTransformPreset,
  type CompilerOptions,
  type NodeTransform,
  type RootNode,
  type SimpleExpressionNode,
} from "@vue/compiler-dom";
import { genString } from "knitwork";
import type { AdditionalImport } from "./codegen/context";
import { isVoidTag } from "@vue/shared";
import { VServerComponentType } from "../runtime/shared";
import { createCodegenContext, withoutRenderlessChildren, genFragment, genNode } from "./codegen";

// Get Vue's default transforms (includes v-if, v-for, etc.)
const [baseNodeTransforms] = getBaseTransformPreset(true);

/**
 * v-on expressions reach codegen unclassified (we stub directiveTransforms),
 * so classify them with Vue's own isMemberExpression / isFnExpression and
 * stash the verdict on the expression node for codegen to read back.
 */
type EventKind = "member" | "fn" | "statement";
type ClassifiedExp = SimpleExpressionNode & { _onigiriEventKind?: EventKind };

const transformVOnEventKind: NodeTransform = (node, context) => {
  if (node.type !== NodeTypes.ELEMENT) return;
  for (const prop of node.props) {
    if (prop.type !== NodeTypes.DIRECTIVE) continue;
    if (prop.name !== "on" || !prop.exp) continue;
    if (prop.exp.type !== NodeTypes.SIMPLE_EXPRESSION) continue;
    const exp = prop.exp as ClassifiedExp;
    if (exp.isStatic) continue;
    exp._onigiriEventKind = isMemberExpression(exp, context)
      ? "member"
      : isFnExpression(exp, context)
        ? "fn"
        : "statement";
  }
};

const onigiriNodeTransforms: NodeTransform[] = [...baseNodeTransforms, transformVOnEventKind];

export interface OnigiriCompilerOptions extends CompilerOptions {
  /** Additional compiler options specific to onigiri */
  onigiriSpecific?: boolean;
  /** SFC scoped style ID (e.g., "data-v-xxxxxxx") - added as attribute to all elements */
  scopeId?: string | null;
  /**
   * Local identifier to root-relative source path for components imported
   * in the SFC's script; matching v-load-client targets inline the path.
   */
  importMap?: Map<string, string>;
  /**
   * Tag to import entry for components the SFC doesn't import statically,
   * looked up under Pascal/camel/kebab casings. `export` defaults to "default".
   */
  additionalImports?: Map<string, AdditionalImport>;
  /**
   * Optional optimization: public chunk URL to bake in place of a
   * root-relative source path. Returning `undefined` is normal and keeps
   * the source path, which the runtime resolves via manifest glob or
   * custom `importFn`.
   */
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
  /**
   * Called for every `v-load-client` target the codegen emits.
   * Forwarded straight to the codegen context.
   */
  registerTarget?: (sourcePath: string) => void;
}

export interface OnigiriCodegenResult {
  code: string;
  ast: RootNode;
  map?: any;
}

/**
 * Compile Vue template to onigiri render function that returns VServerComponent
 */
export function compileOnigiri(
  template: string,
  options: OnigiriCompilerOptions = {},
): OnigiriCodegenResult {
  const { expression, imports, components, ast } = compileOnigiriInline(template, options);

  // Only used to build the module shell, so it needs no compiler options.
  const context = createCodegenContext();

  // Stable ABI: `_ctx` is the instance proxy, `__instance` the raw
  // ComponentInternalInstance forwarded to child serializer calls.
  context.push("export function renderOnigiri(_ctx, __instance) {");
  context.newline();
  context.indent();

  for (const [tag, varName] of components) {
    context.push(`const ${varName} = __onigiri_resolveComponent(__instance, ${genString(tag)})`);
    context.newline();
  }

  context.push("return ");
  context.push(expression);
  context.push(";");

  context.deindent();
  context.newline();
  context.push("}");

  return {
    code: `${[...imports, "\n"].join("\n")}${context.code}`.trim(),
    ast,
    map: undefined,
  };
}

/**
 * Compile a Vue template to an inline expression returning VServerComponent,
 * injected directly into setup() by the Vite plugin.
 */
export function compileOnigiriInline(
  template: string,
  options: OnigiriCompilerOptions = {},
): { expression: string; imports: Set<string>; components: Map<string, string>; ast: RootNode } {
  const ast = baseParse(template, {
    ...options,
    isVoidTag,
  });

  transform(ast, {
    ...options,
    prefixIdentifiers: true,
    expressionPlugins: ["typescript"],
    nodeTransforms: onigiriNodeTransforms,
    directiveTransforms: {},
  });

  const context = createCodegenContext(options);
  const rootChildren = withoutRenderlessChildren(ast.children);
  if (rootChildren.length === 0) {
    context.push("null");
  } else if (rootChildren.length === 1) {
    const before = context.code.length;
    genNode(rootChildren[0], context);
    const produced = context.code.slice(before);
    // A single root v-for emits a `...(...)` spread only valid inside an array literal, so wrap it in a Fragment tuple
    if (produced.startsWith("...")) {
      context.code =
        context.code.slice(0, before) +
        "[" +
        VServerComponentType.Fragment.toString() +
        ", [" +
        produced +
        "]]";
    }
  } else {
    // Multiple root nodes - wrap in fragment
    genFragment(rootChildren, context);
  }

  return {
    expression: context.code,
    imports: context.imports,
    components: context.components, // Map of tag -> varName for resolveComponent declarations
    ast,
  };
}

export * from "./codegen";
