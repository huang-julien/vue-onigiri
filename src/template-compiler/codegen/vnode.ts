/**
 * VNode code generators for the onigiri template compiler.
 * 
 * These functions generate serialized VServerComponent expressions
 * that represent the Vue template in the onigiri format.
 */

import {
  type ElementNode,
  type TextNode,
  type InterpolationNode,
  type CompoundExpressionNode,
  type IfNode,
  type ForNode,
  type AttributeNode,
  type DirectiveNode,
  NodeTypes,
  isSimpleIdentifier
} from "@vue/compiler-dom";
import { genImport } from "knitwork";
import { VServerComponentType } from "../../runtime/shared";
import type { CodegenContext } from "./context";

/**
 * Generate code for any AST node
 */
export function genNode(node: any, context: CodegenContext): void {
  switch (node.type) {
    case NodeTypes.ELEMENT: {
      genElement(node, context);
      break;
    }
    case NodeTypes.TEXT: {
      genText(node, context);
      break;
    }
    case NodeTypes.INTERPOLATION: {
      genInterpolation(node, context);
      break;
    }
    case NodeTypes.COMPOUND_EXPRESSION: {
      genCompoundExpression(node, context);
      break;
    }
    case NodeTypes.IF: {
      genIf(node, context);
      break;
    }
    case NodeTypes.FOR: {
      genFor(node, context);
      break;
    }
    case NodeTypes.COMMENT: {
      // Skip comments in onigiri output
      break;
    }
    default: {
      context.push('null');
    }
  }
}

/**
 * Generate code for element and component nodes
 */
export function genElement(node: ElementNode, context: CodegenContext): void {
  const { tag, props, children } = node;
  
  // Check if it's a component (starts with uppercase or has hyphen like web components)
  const isComponent = /^[A-Z]/.test(tag) || tag.includes('-');
  
  if (isComponent) {
    genComponent(node, context);
  } else {
    genHtmlElement(node, context);
  }
}

/**
 * Generate code for component nodes
 */
function genComponent(node: ElementNode, context: CodegenContext): void {
  const { tag, props, children } = node;
  
  // Check if this component has v-load-client directive
  const hasLoadClient = props.some(
    (p) => p.type === NodeTypes.DIRECTIVE && p.name === 'load-client'
  );
  
  if (hasLoadClient) {
    genClientLoadedComponent(tag, props, children, context);
  } else {
    genServerRenderedComponent(tag, props, children, context);
  }
}

/**
 * Generate code for component with v-load-client directive.
 * These are serialized as Component type and loaded on the client.
 * Format: [VServerComponentType.Component, Props, ChunkPath, ExportName, Slots]
 */
function genClientLoadedComponent(
  tag: string,
  props: (AttributeNode | DirectiveNode)[],
  children: any[],
  context: CodegenContext
): void {
  context.push('[');
  // 1. Type
  context.push(VServerComponentType.Component.toString());
  context.push(', ');

  // 2. Props (filter out v-load-client directive)
  const propsWithoutLoadClient = props.filter(
    (p) => !(p.type === NodeTypes.DIRECTIVE && p.name === 'load-client')
  );
  if (propsWithoutLoadClient.length > 0) {
    genProps(propsWithoutLoadClient, context);
  } else {
    context.push('undefined');
  }
  context.push(', ');

  // 3. ChunkPath - access from component's __chunk property (set by build plugin)
  context.push(`${tag}.__chunk`);
  context.push(', ');

  // 4. ExportName - access from component's __export property (set by build plugin)  
  context.push(`${tag}.__export`);
  context.push(', ');

  // 5. Slots - convert children to default slot
  if (children.length > 0) {
    context.push('{ default: ');
    if (children.length === 1) {
      genNode(children[0], context);
    } else {
      context.push('[');
      for (const [i, child] of children.entries()) {
        if (i > 0) context.push(', ');
        genNode(child, context);
      }
      context.push(']');
    }
    context.push(' }');
  } else {
    context.push('undefined');
  }
  
  context.push(']');
}

/**
 * Generate code for component WITHOUT v-load-client directive.
 * These are rendered server-side and their output is serialized inline.
 * Format: __serializeComponent(Component, props, slots)
 */
function genServerRenderedComponent(
  tag: string,
  props: (AttributeNode | DirectiveNode)[],
  children: any[],
  context: CodegenContext
): void {
  context.push(`__serializeComponent(${tag}, `);
  
  // Props
  if (props.length > 0) {
    genProps(props, context);
  } else {
    context.push('undefined');
  }
  context.push(', ');
  
  // Slots as children
  if (children.length > 0) {
    context.push('{ default: () => [');
    for (const [i, child] of children.entries()) {
      if (i > 0) context.push(', ');
      genNode(child, context);
    }
    context.push('] }');
  } else {
    context.push('undefined');
  }
  
  context.push(')');
}

/**
 * Generate code for HTML elements.
 * Format: [VServerComponentType.Element, tag, attrs, children]
 */
function genHtmlElement(node: ElementNode, context: CodegenContext): void {
  const { tag, props, children } = node;
  
  context.push('[');
  // 1. Type
  context.push(VServerComponentType.Element.toString());
  context.push(', ');
  // 2. Tag name
  context.push(`"${tag}"`);
  context.push(', ');
  
  // 3. Attrs
  if (props.length > 0) {
    genProps(props, context);
  } else {
    context.push('undefined');
  }
  context.push(', ');
  
  // 4. Children
  if (children.length === 0) {
    context.push('undefined');
  } else if (children.length === 1) {
    genNode(children[0], context);
  } else {
    context.push('[');
    for (const [i, child] of children.entries()) {
      if (i > 0) context.push(', ');
      genNode(child, context);
    }
    context.push(']');
  }
  
  context.push(']');
}

/**
 * Generate code for props/attributes
 */
export function genProps(props: (AttributeNode | DirectiveNode)[], context: CodegenContext): void {
  // Check if we have a v-bind without argument (object spread)
  const bindDirective = props.find(prop => 
    prop.type === NodeTypes.DIRECTIVE && 
    prop.name === 'bind' && 
    !prop.arg
  );
  
  // Get all other props (not the v-bind object spread)
  const otherProps = props.filter(prop => 
    !(prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind' && !prop.arg)
  );
  
  if (bindDirective && typeof bindDirective === 'object' && 'exp' in bindDirective) {
    if (otherProps.length > 0) {
      // We have both v-bind object and other props - need to merge
      context.imports.add(genImport('vue', [{ name: 'mergeProps', as: '_mergeProps' }]));
      context.push('_mergeProps(');
      if (bindDirective.exp && typeof bindDirective.exp === 'object' && 'content' in bindDirective.exp) {
        context.push(`_ctx.${bindDirective.exp.content}`);
      } else {
        context.push('undefined');
      }
      context.push(', ');
      
      // Generate the other props object
      genPropsObject(otherProps, context);
      context.push(')');
    } else {
      // Only v-bind object, no other props
      if (bindDirective.exp && typeof bindDirective.exp === 'object' && 'content' in bindDirective.exp) {
        context.push(`_ctx.${bindDirective.exp.content}`);
      } else {
        context.push('undefined');
      }
    }
    return;
  }
  
  // No v-bind object spread - just regular props
  genPropsObject(props, context);
}

/**
 * Generate a props object literal
 */
function genPropsObject(props: (AttributeNode | DirectiveNode)[], context: CodegenContext): void {
  context.push('{');
  let first = true;
  
  for (const prop of props) {
    if (prop.type === NodeTypes.ATTRIBUTE) {
      if (!first) context.push(', ');
      first = false;
      
      context.push(`"${prop.name}": `);
      if (prop.value) {
        context.push(`"${prop.value.content}"`);
      } else {
        context.push('true');
      }
    } else if (prop.type === NodeTypes.DIRECTIVE) {
      if (!first) context.push(', ');
      first = false;
      
      const attrName = (prop.arg && typeof prop.arg === 'object' && 'content' in prop.arg) 
        ? prop.arg.content 
        : prop.name;
      context.push(`"${attrName}": `);
      
      if (prop.exp) {
        if (prop.exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          if (isSimpleIdentifier(prop.exp.content)) {
            context.push(`_ctx.${prop.exp.content}`);
          } else {
            context.push(prop.exp.content);
          }
        } else if (prop.exp.type === NodeTypes.COMPOUND_EXPRESSION) {
          // Handle compound expressions
          context.push(`(${prop.exp.children.map(child => {
            if (typeof child === 'string') {
              return `"${child}"`;
            } else if (typeof child === 'object' && child !== null && 'type' in child && child.type === NodeTypes.SIMPLE_EXPRESSION && 'content' in child) {
              return `_ctx.${child.content}`;
            }
            return '';
          }).join(' + ')})`);
        }
      } else {
        context.push('true');
      }
    }
  }
  
  context.push('}');
}

/**
 * Generate code for text nodes.
 * Format: [VServerComponentType.Text, content]
 */
export function genText(node: TextNode, context: CodegenContext): void {
  context.push('[');
  context.push(VServerComponentType.Text.toString());
  context.push(', ');
  context.push(`"${node.content}"`);
  context.push(']');
}

/**
 * Generate code for interpolation nodes ({{ expression }}).
 * Format: [VServerComponentType.Text, dynamicValue]
 */
export function genInterpolation(node: InterpolationNode, context: CodegenContext): void {
  context.push('[');
  context.push(VServerComponentType.Text.toString());
  context.push(', ');
  if (node.content.type === NodeTypes.SIMPLE_EXPRESSION) {
    context.push((node.content as any).content);
  } else {
    context.push(`String(${(node.content as any).content})`);
  }
  context.push(']');
}

/**
 * Generate code for compound expression nodes.
 * Format: [VServerComponentType.Text, concatenatedValue]
 */
export function genCompoundExpression(node: CompoundExpressionNode, context: CodegenContext): void {
  context.push('[');
  context.push(VServerComponentType.Text.toString());
  context.push(', ');
  context.push('(');
  
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (typeof child === 'string') {
      context.push(`"${child}"`);
    } else if (child && typeof child === 'object' && 'type' in child) {
      if (child.type === NodeTypes.INTERPOLATION) {
        const content = (child as any).content;
        if (content.type === NodeTypes.SIMPLE_EXPRESSION) {
          context.push(content.content);
        } else {
          context.push(`String(${content.content})`);
        }
      } else if (child.type === NodeTypes.SIMPLE_EXPRESSION) {
        context.push((child as any).content);
      }
    }
    
    if (i < node.children.length - 1) {
      context.push(' + ');
    }
  }
  
  context.push(')');
  context.push(']');
}

/**
 * Generate code for v-if/v-else-if/v-else nodes.
 * Outputs ternary expressions.
 */
export function genIf(node: IfNode, context: CodegenContext): void {
  const firstBranch = node.branches[0];
  if (!firstBranch) {
    context.push('null');
    return;
  }

  context.push('(');
  if (firstBranch.condition) {
    const condition = (firstBranch.condition as any);
    if (condition.type === NodeTypes.SIMPLE_EXPRESSION) {
      context.push(condition.content);
    } else {
      context.push('true');
    }
  } else {
    context.push('true');
  }
  
  context.push(' ? ');
  
  if (firstBranch.children.length === 1) {
    genNode(firstBranch.children[0], context);
  } else {
    context.push('[');
    context.push(VServerComponentType.Fragment.toString());
    context.push(', [');
    for (let i = 0; i < firstBranch.children.length; i++) {
      if (i > 0) context.push(', ');
      genNode(firstBranch.children[i], context);
    }
    context.push(']]');
  }
  
  context.push(' : ');
  
  if (node.branches.length > 1 && node.branches[1]) {
    // Handle else/else-if
    const elseBranch = node.branches[1];
    if (elseBranch.condition) {
      // else-if - create a new if node
      const newIfNode = { ...node, branches: node.branches.slice(1) };
      genIf(newIfNode, context);
    } else {
      // else
      if (elseBranch.children.length === 1) {
        genNode(elseBranch.children[0], context);
      } else {
        context.push('[');
        context.push(VServerComponentType.Fragment.toString());
        context.push(', [');
        for (let i = 0; i < elseBranch.children.length; i++) {
          if (i > 0) context.push(', ');
          genNode(elseBranch.children[i], context);
        }
        context.push(']]');
      }
    }
  } else {
    context.push('null');
  }
  
  context.push(')');
}

/**
 * Generate code for v-for nodes.
 * Outputs .map() array operations.
 */
export function genFor(node: ForNode, context: CodegenContext): void {
  const { source, value, key, index } = node.parseResult;
  
  context.push('(');
  context.push((source as any).content);
  context.push('.map((');
  context.push((value as any)?.content || 'item');
  if (key) {
    context.push(', ');
    context.push((key as any).content);
  }
  if (index) {
    context.push(', ');
    context.push((index as any).content);
  }
  context.push(') => ');
  
  if (node.children.length === 1) {
    genNode(node.children[0], context);
  } else {
    context.push('[');
    context.push(VServerComponentType.Fragment.toString());
    context.push(', [');
    for (let i = 0; i < node.children.length; i++) {
      if (i > 0) context.push(', ');
      genNode(node.children[i], context);
    }
    context.push(']]');
  }
  
  context.push('))');
}
