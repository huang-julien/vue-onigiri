
import { 
  baseParse, 
  transform,
  type CompilerOptions, 
  type RootNode,
  type ElementNode,
  type TextNode,
  type InterpolationNode,
  type CompoundExpressionNode,
  type IfNode,
  type ForNode,
  NodeTypes,
  type AttributeNode,
  type DirectiveNode,
  isStaticExp,
  isSimpleIdentifier
} from "@vue/compiler-dom";
import { VServerComponentType } from "../runtime/shared";
import { genImport } from "knitwork"
export interface OnigiriCompilerOptions extends CompilerOptions {
  /** Additional compiler options specific to onigiri */
  onigiriSpecific?: boolean;
}

export interface OnigiriCodegenResult {
  code: string;
  ast: RootNode;
  map?: any;
}

// Simple context for code generation
interface SimpleCodegenContext {
  code: string;
  indentLevel: number;
  push(code: string): void;
  indent(): void;
  deindent(): void;
  newline(): void;
  imports: Set<string>;
}

function createSimpleContext(): SimpleCodegenContext {
  return {
    code: '',
    indentLevel: 0,
    imports: new Set<string>(),
    push(code: string) {
      this.code += code;
    },
    indent() {
      this.indentLevel++;
    },
    deindent() {
      this.indentLevel--;
    },
    newline() {
      this.code += '\n' + '  '.repeat(this.indentLevel);
    }
  };
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
  const context = createSimpleContext();

  // Generate the function preamble
  context.push('export function renderOnigiri(_ctx) {');
  context.newline();
  context.indent();

  // Generate the main render logic
  if (ast.children.length === 0) {
    context.push('return null;');
  } else if (ast.children.length === 1) {
    context.push('return ');
    genOnigiriNode(ast.children[0], context);
    context.push(';');
  } else {
    // Multiple root nodes - wrap in fragment
    context.push('return [');
    context.push(VServerComponentType.Fragment.toString());
    context.push(', [');
    for (let i = 0; i < ast.children.length; i++) {
      if (i > 0) context.push(', ');
      genOnigiriNode(ast.children[i], context);
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

function genOnigiriNode(node: any, context: SimpleCodegenContext): void {
  switch (node.type) {
    case NodeTypes.ELEMENT: {
      genOnigiriElement(node, context);
      break;
    }
    case NodeTypes.TEXT: {
      genOnigiriText(node, context);
      break;
    }
    case NodeTypes.INTERPOLATION: {
      genOnigiriInterpolation(node, context);
      break;
    }
    case NodeTypes.COMPOUND_EXPRESSION: {
      genOnigiriCompoundExpression(node, context);
      break;
    }
    case NodeTypes.IF: {
      genOnigiriIf(node, context);
      break;
    }
    case NodeTypes.FOR: {
      genOnigiriFor(node, context);
      break;
    }
    case NodeTypes.COMMENT: {
      // Skip comments in onigiri
      break;
    }
    default: {
      context.push('null');
    }
  }
}

function genOnigiriElement(node: ElementNode, context: SimpleCodegenContext): void {
  const { tag, props, children } = node;
  
  // Check if it's a component (starts with uppercase) or regular element
  const isComponent = /^[A-Z]/.test(tag) || tag.includes('-');
  
  if (isComponent) {
    // Component: [VServerComponentType.Component, props, chunkPath, slots]
    context.push('[');
    // 1 type
    context.push(VServerComponentType.Component.toString());
    context.push(', ');

    // 2 tag name
    // ChunkPath - for now, use the component name
    context.push(tag);
    context.push(', ');
    
    // 3 Props
    if (props.length > 0) {
      genOnigiriProps(props, context);
    } else {
      context.push('undefined');
    }
    context.push(', ');

    // 4 Slots - convert children to default slot
    if (children.length > 0) {
      context.push('{ default: ');
      if (children.length === 1) {
        genOnigiriNode(children[0], context);
      } else {
        context.push('[');
        for (const [i, child] of children.entries()) {
          if (i > 0) context.push(', ');
          genOnigiriNode(child, context);
        }
        context.push(']');
      }
      context.push(' }');
    } else {
      context.push('undefined');
    }
    
    context.push(']');
  } else {
    // Element: [VServerComponentType.Element, tag, attrs, children]
    context.push('[');
    // 1 type
    context.push(VServerComponentType.Element.toString());
    context.push(', ');
    // 2 tag name
    context.push(`"${tag}"`);
    context.push(', ');
    
    // 3 Attrs
    if (props.length > 0) {
      genOnigiriProps(props, context);
    } else {
      context.push('undefined');
    }
    context.push(', ');
    
    // 4 Children
    if (children.length === 0) {
      context.push('undefined');
    } else if (children.length === 1) {
      genOnigiriNode(children[0], context);
    } else {
      context.push('[');
      for (const [i, child] of children.entries()) {
        if (i > 0) context.push(', ');
        genOnigiriNode(child, context);
      }
      context.push(']');
    }
    
    context.push(']');
  }
}

function genOnigiriProps(props: (AttributeNode | DirectiveNode)[], context: SimpleCodegenContext): void {
  // Check if we have a v-bind without argument (object spread)
  const bindDirective = props.find(prop => 
    prop.type === NodeTypes.DIRECTIVE && 
    prop.name === 'bind' && 
    !prop.arg
  );
  console.log(props)
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
      context.push('{');
      let first = true;
      
      for (const prop of otherProps) {
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
          
          if (prop.exp && typeof prop.exp === 'object' && 'content' in prop.exp) {
            context.push(`_ctx.${prop.exp.content}`);
          } else {
            context.push('true');
          }
        }
      }
      
      context.push('}');
      context.push(')');
    } else {
      console.log('Only v-bind object found:', bindDirective);
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
          if(isSimpleIdentifier(prop.exp.content)) {
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

function genOnigiriText(node: TextNode, context: SimpleCodegenContext): void {
  // Text: [VServerComponentType.Text, content]
  context.push('[');
  context.push(VServerComponentType.Text.toString());
  context.push(', ');
  context.push(`"${node.content}"`);
  context.push(']');
}

function genOnigiriInterpolation(node: InterpolationNode, context: SimpleCodegenContext): void {
  // Interpolation becomes dynamic text
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

function genOnigiriCompoundExpression(node: CompoundExpressionNode, context: SimpleCodegenContext): void {
  // Compound expression becomes dynamic text
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

function genOnigiriIf(node: IfNode, context: SimpleCodegenContext): void {
  // Generate conditional logic
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
    genOnigiriNode(firstBranch.children[0], context);
  } else {
    context.push('[');
    context.push(VServerComponentType.Fragment.toString());
    context.push(', [');
    for (let i = 0; i < firstBranch.children.length; i++) {
      if (i > 0) context.push(', ');
      genOnigiriNode(firstBranch.children[i], context);
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
      genOnigiriIf(newIfNode, context);
    } else {
      // else
      if (elseBranch.children.length === 1) {
        genOnigiriNode(elseBranch.children[0], context);
      } else {
        context.push('[');
        context.push(VServerComponentType.Fragment.toString());
        context.push(', [');
        for (let i = 0; i < elseBranch.children.length; i++) {
          if (i > 0) context.push(', ');
          genOnigiriNode(elseBranch.children[i], context);
        }
        context.push(']]');
      }
    }
  } else {
    context.push('null');
  }
  
  context.push(')');
}

function genOnigiriFor(node: ForNode, context: SimpleCodegenContext): void {
  // Generate v-for loop
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
    genOnigiriNode(node.children[0], context);
  } else {
    context.push('[');
    context.push(VServerComponentType.Fragment.toString());
    context.push(', [');
    for (let i = 0; i < node.children.length; i++) {
      if (i > 0) context.push(', ');
      genOnigiriNode(node.children[i], context);
    }
    context.push(']]');
  }
  
  context.push('))');
}
