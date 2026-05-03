/**
 * Onigiri Template Compiler
 *
 * Compiles Vue templates to onigiri render functions that return
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
} from '@vue/compiler-dom'
import { isVoidTag } from '@vue/shared'
import { VServerComponentType } from '../runtime/shared'
import { createCodegenContext, genNode } from './codegen'

// Get Vue's default transforms (includes v-if, v-for, etc.)
const [baseNodeTransforms] = getBaseTransformPreset(true)

/**
 * Vue's `transformExpression` skips `v-on` (defers to `transformOn`) and we
 * stub out `directiveTransforms`, so v-on expressions reach codegen
 * unclassified. Mirror Vue's own decision: use `isMemberExpression` /
 * `isFnExpression` from `@vue/compiler-dom`, which parse with `@babel/parser`
 * under the hood. Stash the verdict on the expression so codegen reads it
 * back without needing a `TransformContext`.
 */
type EventKind = 'member' | 'fn' | 'statement'
type ClassifiedExp = SimpleExpressionNode & { _onigiriEventKind?: EventKind }

const transformVOnEventKind: NodeTransform = (node, context) => {
  if (node.type !== NodeTypes.ELEMENT) return
  for (const prop of node.props) {
    if (prop.type !== NodeTypes.DIRECTIVE) continue
    if (prop.name !== 'on' || !prop.exp) continue
    if (prop.exp.type !== NodeTypes.SIMPLE_EXPRESSION) continue
    const exp = prop.exp as ClassifiedExp
    if (exp.isStatic) continue
    exp._onigiriEventKind = isMemberExpression(exp, context)
      ? 'member'
      : (isFnExpression(exp, context)
          ? 'fn'
          : 'statement')
  }
}

const onigiriNodeTransforms: NodeTransform[] = [...baseNodeTransforms, transformVOnEventKind]

export interface OnigiriCompilerOptions extends CompilerOptions {
  /** Additional compiler options specific to onigiri */
  onigiriSpecific?: boolean
  /** SFC scoped style ID (e.g., "data-v-xxxxxxx") - added as attribute to all elements */
  scopeId?: string | null
  /**
   * Map of local identifier → root-relative source path for components
   * statically imported in this SFC's `<script>` block.
   * When a `v-load-client` component's tag matches a key, the compiler
   * emits the literal path as `__chunk` instead of a runtime property
   * lookup. Unmapped identifiers fall back to `Component.__chunk`.
   */
  importMap?: Map<string, string>
}

export interface OnigiriCodegenResult {
  code: string
  ast: RootNode
  map?: any
}

/**
 * Compile Vue template to onigiri render function that returns VServerComponent
 */
export function compileOnigiri(
  template: string,
  options: OnigiriCompilerOptions = {},
): OnigiriCodegenResult {
  // Parse the template with HTML void tag recognition
  const ast = baseParse(template, {
    ...options,
    isVoidTag,
  })

  // Transform the AST with Vue's default transforms (v-if, v-for, expressions, etc.)
  // `expressionPlugins: ['typescript']` lets template expressions contain
  // TS-only syntax like `(x as any)?.foo` (from SFCs with `lang="ts"`).
  transform(ast, {
    ...options,
    prefixIdentifiers: true,
    expressionPlugins: ['typescript'],
    nodeTransforms: onigiriNodeTransforms,
    directiveTransforms: {},
  })

  // Generate the onigiri code
  const context = createCodegenContext({
    bindingMetadata: options.bindingMetadata,
    scopeId: options.scopeId,
    importMap: options.importMap,
    isCustomElement: options.isCustomElement,
  })

  // First, generate the return expression to collect component references
  const bodyContext = createCodegenContext({
    bindingMetadata: options.bindingMetadata,
    scopeId: options.scopeId,
    importMap: options.importMap,
    isCustomElement: options.isCustomElement,
  })
  if (ast.children.length === 0) {
    bodyContext.push('null')
  }
  else if (ast.children.length === 1) {
    genNode(ast.children[0], bodyContext)
  }
  else {
    // Multiple root nodes - wrap in fragment
    bodyContext.push('[')
    bodyContext.push(VServerComponentType.Fragment.toString())
    bodyContext.push(', [')
    for (let i = 0; i < ast.children.length; i++) {
      if (i > 0) bodyContext.push(', ')
      genNode(ast.children[i], bodyContext)
    }
    bodyContext.push(']]')
  }

  // Merge imports from body context
  for (const imp of bodyContext.imports) {
    context.imports.add(imp)
  }

  // Stable onigiri ABI: single signature across dev/prod.
  // - _ctx is the component instance proxy (props/setup/data/options unified).
  // - __instance is the raw ComponentInternalInstance, forwarded to child
  //   serializer calls as their parent instance.
  context.push('export function renderOnigiri(_ctx, __instance) {')
  context.newline()
  context.indent()

  for (const [tag, varName] of bodyContext.components) {
    context.push(`const ${varName} = __onigiri_resolveComponent(__instance, "${tag}")`)
    context.newline()
  }

  // Add the return statement
  context.push('return ')
  context.push(bodyContext.code)
  context.push(';')

  context.deindent()
  context.newline()
  context.push('}')

  return {
    code: `${[...context.imports, '\n'].join('\n')}${context.code}`.trim(),
    ast,
    map: undefined,
  }
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
  options: OnigiriCompilerOptions = {},
): { expression: string, imports: Set<string>, components: Map<string, string>, ast: RootNode } {
  // Parse the template with HTML void tag recognition
  const ast = baseParse(template, {
    ...options,
    isVoidTag,
  })

  // Transform the AST with Vue's default transforms.
  transform(ast, {
    ...options,
    prefixIdentifiers: true,
    expressionPlugins: ['typescript'],
    nodeTransforms: onigiriNodeTransforms,
    directiveTransforms: {},
  })

  // Generate just the expression, no function wrapper
  const context = createCodegenContext({
    bindingMetadata: options.bindingMetadata,
    scopeId: options.scopeId,
    importMap: options.importMap,
    isCustomElement: options.isCustomElement,
  })

  if (ast.children.length === 0) {
    context.push('null')
  }
  else if (ast.children.length === 1) {
    genNode(ast.children[0], context)
  }
  else {
    // Multiple root nodes - wrap in fragment
    context.push('[')
    context.push(VServerComponentType.Fragment.toString())
    context.push(', [')
    for (let i = 0; i < ast.children.length; i++) {
      if (i > 0) context.push(', ')
      genNode(ast.children[i], context)
    }
    context.push(']]')
  }

  return {
    expression: context.code,
    imports: context.imports,
    components: context.components, // Map of tag -> varName for resolveComponent declarations
    ast,
  }
}

// Re-export codegen utilities for direct access
export * from './codegen'
