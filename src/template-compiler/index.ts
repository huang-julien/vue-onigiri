/**
 * Onigiri Template Compiler
 * 
 * Compiles Vue templates to onigiri render functions that return
 * serialized VServerComponent structures.
 */

import { 
  baseParse, 
  transform,
  type CompilerOptions, 
  type RootNode,
} from "@vue/compiler-dom";
import { VServerComponentType } from "../runtime/shared";
import { createCodegenContext, genNode } from "./codegen";

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
  // Parse the template
  const ast = baseParse(template, options);
  
  // Transform the AST (minimal transforms for basic functionality)
  transform(ast, {
    ...options,
    nodeTransforms: [],
    directiveTransforms: {}
  });

  // Generate the onigiri code
  const context = createCodegenContext();

  // Generate the function preamble
  context.push('export function renderOnigiri(_ctx) {');
  context.newline();
  context.indent();

  // Generate the main render logic
  if (ast.children.length === 0) {
    context.push('return null;');
  } else if (ast.children.length === 1) {
    context.push('return ');
    genNode(ast.children[0], context);
    context.push(';');
  } else {
    // Multiple root nodes - wrap in fragment
    context.push('return [');
    context.push(VServerComponentType.Fragment.toString());
    context.push(', [');
    for (let i = 0; i < ast.children.length; i++) {
      if (i > 0) context.push(', ');
      genNode(ast.children[i], context);
    }
    context.push(']];');
  }

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
 * @returns An object with the inline expression (no function wrapper)
 */
export function compileOnigiriInline(
  template: string,
  options: OnigiriCompilerOptions = {}
): { expression: string; ast: RootNode } {
  // Parse the template
  const ast = baseParse(template, options);

  // Transform the AST (minimal transforms for basic functionality)
  transform(ast, {
    ...options,
    nodeTransforms: [],
    directiveTransforms: {}
  });

  // Generate just the expression, no function wrapper
  const context = createCodegenContext();

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
    ast
  };
}

// Re-export codegen utilities for direct access
export * from './codegen';
