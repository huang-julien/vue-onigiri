/**
 * Onigiri Template Compiler
 * 
 * Compiles Vue templates to onigiri render functions that return
 * serialized VServerComponent structures.
 */

import { 
  baseParse, 
  transform,
  getBaseTransformPreset,
  type CompilerOptions, 
  type RootNode,
} from "@vue/compiler-dom";
import { isVoidTag } from "@vue/shared";
import { VServerComponentType } from "../runtime/shared";
import { createCodegenContext, genNode } from "./codegen";

// Get Vue's default transforms (includes v-if, v-for, etc.)
const [baseNodeTransforms] = getBaseTransformPreset(true);

export interface OnigiriCompilerOptions extends CompilerOptions {
  /** Additional compiler options specific to onigiri */
  onigiriSpecific?: boolean;
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
  options: OnigiriCompilerOptions = {}
): OnigiriCodegenResult {
  // Parse the template with HTML void tag recognition
  const ast = baseParse(template, {
    ...options,
    isVoidTag,
  });
  
  // Transform the AST with Vue's default transforms (v-if, v-for, expressions, etc.)
  transform(ast, {
    ...options,
    prefixIdentifiers: true,
    nodeTransforms: baseNodeTransforms,
    directiveTransforms: {}
  });

  // Generate the onigiri code
  const context = createCodegenContext(options.bindingMetadata);

  // First, generate the return expression to collect component references
  const bodyContext = createCodegenContext(options.bindingMetadata);
  if (ast.children.length === 0) {
    bodyContext.push('null');
  } else if (ast.children.length === 1) {
    genNode(ast.children[0], bodyContext);
  } else {
    // Multiple root nodes - wrap in fragment
    bodyContext.push('[');
    bodyContext.push(VServerComponentType.Fragment.toString());
    bodyContext.push(', [');
    for (let i = 0; i < ast.children.length; i++) {
      if (i > 0) bodyContext.push(', ');
      genNode(ast.children[i], bodyContext);
    }
    bodyContext.push(']]');
  }

  // Merge imports from body context
  for (const imp of bodyContext.imports) {
    context.imports.add(imp);
  }

  // Generate the function with component declarations
  // Match Vue's render function signature:
  // Dev: function render(_ctx, _cache, $props, $setup, $data, $options)
  // Prod: function render(_ctx, _cache)
  context.push('export function renderOnigiri(_ctx, _cache, $props, $setup, $data, $options) {');
  context.newline();
  context.indent();

  // Inject component declarations
  for (const [tag, varName] of bodyContext.components) {
    context.push(`const ${varName} = _resolveComponent("${tag}")`);
    context.newline();
  }

  // Add the return statement
  context.push('return ');
  context.push(bodyContext.code);
  context.push(';');

  context.deindent();
  context.newline();
  context.push('}');

  return {
    code: `${[...context.imports, '\n'].join('\n')}${context.code}`.trim(),
    ast,
    map: undefined
  };
}

/**
 * Compile Vue template to an inline expression that returns VServerComponent.
 * This is used by the Vite plugin to inject directly into setup() without
 * an extra function wrapper - maximum performance.
 *
 * @param template - The Vue template string
 * @param options - Compiler options including binding metadata
 * @returns An object with the inline expression, imports, and component declarations
 */
export function compileOnigiriInline(
  template: string,
  options: OnigiriCompilerOptions = {}
): { expression: string; imports: Set<string>; components: Map<string, string>; ast: RootNode } {
  // Parse the template with HTML void tag recognition
  const ast = baseParse(template, {
    ...options,
    isVoidTag,
  });

  // Transform the AST with Vue's default transforms
  transform(ast, {
    ...options,
    prefixIdentifiers: true,
    nodeTransforms: baseNodeTransforms,
    directiveTransforms: {}
  });

  // Generate just the expression, no function wrapper
  const context = createCodegenContext(options.bindingMetadata);

  if (ast.children.length === 0) {
    context.push('null');
  } else if (ast.children.length === 1) {
    genNode(ast.children[0], context);
  } else {
    // Multiple root nodes - wrap in fragment
    context.push('[');
    context.push(VServerComponentType.Fragment.toString());
    context.push(', [');
    for (let i = 0; i < ast.children.length; i++) {
      if (i > 0) context.push(', ');
      genNode(ast.children[i], context);
    }
    context.push(']]');
  }

  return {
    expression: context.code,
    imports: context.imports,
    components: context.components, // Map of tag -> varName for resolveComponent declarations
    ast
  };
}

// Re-export codegen utilities for direct access
export * from './codegen';
