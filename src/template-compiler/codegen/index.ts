/**
 * Code generation utilities for the onigiri template compiler.
 */

export { createCodegenContext, type CodegenContext } from './context';
export { 
  genNode,
  genElement,
  genText,
  genInterpolation,
  genCompoundExpression,
  genIf,
  genFor,
  genProps
} from './vnode';
