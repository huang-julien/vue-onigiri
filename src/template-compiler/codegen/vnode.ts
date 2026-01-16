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
  type ExpressionNode,
  type SimpleExpressionNode,
  type BindingMetadata,
  NodeTypes,
  BindingTypes,
} from "@vue/compiler-dom";
import { genImport } from "knitwork";
import { VServerComponentType } from "../../runtime/shared";
import type { CodegenContext } from "./context";

/**
 * Set of HTML void elements that cannot have children.
 * These elements are self-closing and should not have an end tag.
 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

/**
 * Represents a parsed slot from component children.
 */
interface ParsedSlot {
  name: string;
  slotProps: string | null; // The scoped slot parameter (e.g., "scoped" from #test="scoped")
  children: any[];
}

/**
 * Parse children of a component to extract named and default slots.
 * Handles <template #slotName="slotProps"> syntax.
 */
function parseSlots(children: any[]): ParsedSlot[] {
  const slots: ParsedSlot[] = [];
  const defaultChildren: any[] = [];
  
  for (const child of children) {
    // Check if this is a <template> with v-slot directive
    if (child.type === NodeTypes.ELEMENT && child.tag === 'template') {
      const slotDirective = child.props?.find(
        (p: any) => p.type === NodeTypes.DIRECTIVE && p.name === 'slot'
      ) as DirectiveNode | undefined;
      
      if (slotDirective) {
        // Extract slot name from the directive argument
        let slotName = 'default';
        if (slotDirective.arg && slotDirective.arg.type === NodeTypes.SIMPLE_EXPRESSION) {
          slotName = (slotDirective.arg as SimpleExpressionNode).content;
        }
        
        // Extract slot props (scoped slot parameter)
        let slotProps: string | null = null;
        if (slotDirective.exp && slotDirective.exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          slotProps = (slotDirective.exp as SimpleExpressionNode).content;
        }
        
        slots.push({
          name: slotName,
          slotProps,
          children: child.children || []
        });
        continue;
      }
    }
    
    // Not a named slot template - goes to default slot
    defaultChildren.push(child);
  }
  
  // Add default slot if there are any non-template children
  if (defaultChildren.length > 0) {
    slots.push({
      name: 'default',
      slotProps: null,
      children: defaultChildren
    });
  }
  
  return slots;
}

/**
 * Generate the slots object for a component.
 * Handles both named slots and scoped slots.
 */
function genSlotsObject(children: any[], context: CodegenContext, asFunction: boolean): void {
  const slots = parseSlots(children);
  
  if (slots.length === 0) {
    context.push('undefined');
    return;
  }
  
  context.push('{ ');
  
  for (const [i, slot] of slots.entries()) {
    if (i > 0) context.push(', ');
    
    context.push(`"${slot.name}": `);
    
    if (asFunction) {
      // Server-side: slots are functions that return arrays
      if (slot.slotProps) {
        context.push(`(${slot.slotProps}) => `);
      } else {
        context.push('() => ');
      }
      context.push('[');
      for (const [j, child] of slot.children.entries()) {
        if (j > 0) context.push(', ');
        genNode(child, context);
      }
      context.push(']');
    } else {
      // Client-side: slots are serialized VNodes (not functions)
      if (slot.children.length === 1) {
        genNode(slot.children[0], context);
      } else {
        context.push('[');
        for (const [j, child] of slot.children.entries()) {
          if (j > 0) context.push(', ');
          genNode(child, context);
        }
        context.push(']');
      }
    }
  }
  
  context.push(' }');
}

/**
 * Check if an expression is a member expression (like `foo`, `obj.method`, `a['b']`).
 * Member expressions are used as-is for event handlers since they reference functions.
 * 
 * This is a simplified check - it uses regex-based detection similar to Vue's browser mode.
 */
function isMemberExpression(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  
  // Check for function calls with arguments: foo() or foo(a, b)
  // But allow method chains: foo().bar or foo()['baz']
  const fnCallMatch = trimmed.match(/\([^)]*\)\s*$/);
  if (fnCallMatch && !trimmed.endsWith(']')) {
    // Ends with function call but not property access after
    const beforeCall = trimmed.slice(0, trimmed.lastIndexOf('('));
    // Check if this is a simple identifier or member access followed by ()
    if (/^[\w$][\w$\d]*$/.test(beforeCall.trim()) || 
        /[.\]]\s*$/.test(beforeCall.trim())) {
      // This is a function call like foo() or obj.method() - which counts as member expression
      return true;
    }
  }
  
  // Simple identifier: foo, _bar, $baz
  if (/^[\w$][\w$\d]*$/.test(trimmed)) {
    return true;
  }
  
  // Member expression with dots: foo.bar, obj.method
  // Or with brackets: foo['bar'], obj[key]
  // Or optional chaining: foo?.bar
  // Use a simple state machine to validate
  let state: 'start' | 'ident' | 'dot' | 'bracket' | 'string' = 'start';
  let bracketDepth = 0;
  let parenDepth = 0;
  let stringChar: string | null = null;
  
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    
    if (stringChar) {
      if (char === stringChar && trimmed[i - 1] !== '\\') {
        stringChar = null;
        state = 'ident';
      }
      continue;
    }
    
    if (char === '"' || char === "'" || char === '`') {
      if (state !== 'bracket' && state !== 'start') return false;
      stringChar = char;
      continue;
    }
    
    if (char === '(') {
      parenDepth++;
      continue;
    }
    if (char === ')') {
      parenDepth--;
      if (parenDepth < 0) return false;
      state = 'ident';
      continue;
    }
    
    if (parenDepth > 0) continue; // Inside function call - skip
    
    if (char === '[') {
      if (state !== 'ident' && state !== 'start') return false;
      bracketDepth++;
      state = 'bracket';
      continue;
    }
    if (char === ']') {
      bracketDepth--;
      if (bracketDepth < 0) return false;
      if (bracketDepth === 0) state = 'ident';
      continue;
    }
    
    if (bracketDepth > 0) continue; // Inside brackets - skip
    
    if (char === '.' || (char === '?' && trimmed[i + 1] === '.')) {
      if (state !== 'ident') return false;
      state = 'dot';
      if (char === '?') i++; // Skip the '.' in '?.'
      continue;
    }
    
    if (/[\w$]/.test(char)) {
      if (state === 'dot' || state === 'start') {
        state = 'ident';
      } else if (state !== 'ident') {
        return false;
      }
      continue;
    }
    
    if (/\s/.test(char)) continue; // Whitespace is ok
    
    // Any other character means it's not a simple member expression
    return false;
  }
  
  return state === 'ident' && bracketDepth === 0 && parenDepth === 0;
}

/**
 * Check if an expression is already a function expression.
 * Function expressions include arrow functions and function declarations.
 */
function isFnExpression(content: string): boolean {
  const trimmed = content.trim();
  
  // Arrow function patterns:
  // () => ...
  // x => ...
  // (x) => ...
  // (x, y) => ...
  // async () => ...
  // async x => ...
  const arrowFnRE = /^\s*(?:async\s*)?(?:\([^)]*?\)|[\w$_]+)\s*(?::[^=]+)?=>/;
  if (arrowFnRE.test(trimmed)) {
    return true;
  }
  
  // Function expression patterns:
  // function() { ... }
  // function foo() { ... }
  // async function() { ... }
  const fnExprRE = /^\s*(?:async\s+)?function(?:\s+[\w$]+)?\s*\(/;
  if (fnExprRE.test(trimmed)) {
    return true;
  }
  
  return false;
}

/**
 * Wrap an event handler expression if it's an inline statement.
 * - Member expressions (e.g., `handleClick`, `obj.method`) are used as-is
 * - Function expressions (e.g., `() => {}`, `$event => foo($event)`) are used as-is
 * - Inline statements (e.g., `count++`, `foo()`) are wrapped in `$event => (expr)`
 * - Multiple statements (containing `;`) are wrapped in `$event => { expr }`
 */
function wrapEventHandler(content: string, context: CodegenContext): string {
  const trimmed = content.trim();
   
  if (isMemberExpression(trimmed)) {
    return prefixIdentifiers(trimmed, context.bindingMetadata);
  }
  
  if (isFnExpression(trimmed)) {
    return prefixIdentifiers(trimmed, context.bindingMetadata);
  }
  const hasMultipleStatements = trimmed.includes(';');
  const prefixed = prefixIdentifiers(trimmed, context.bindingMetadata);
  
  return hasMultipleStatements
    ? `$event => { ${prefixed} }`
    : `$event => (${prefixed})`;
}

/**
 * get the correct prefix for an identifier based on its binding type.
 * matches how Vue generates render function code.
 */
function getIdentifierPrefix(ident: string, bindingMetadata: BindingMetadata = {}): string {
  const bindingType = bindingMetadata[ident];
  
  switch (bindingType) {
    case BindingTypes.SETUP_CONST:
    case BindingTypes.SETUP_REACTIVE_CONST:
    case BindingTypes.SETUP_LET:
    case BindingTypes.SETUP_REF:
    case BindingTypes.SETUP_MAYBE_REF:
    case BindingTypes.LITERAL_CONST: {
      return '$setup.';
    }
    case BindingTypes.PROPS: {
      return '$props.';
    }
    case BindingTypes.PROPS_ALIASED: {
      return '$props.';
    }
    case BindingTypes.DATA: {
      return '$data.';
    }
    case BindingTypes.OPTIONS: {
      return '_ctx.';
    }
    default: {
      // Unknown binding or no binding - use _ctx
      return '_ctx.';
    }
  }
}

/**
 * Prefix identifiers in a simple expression with the appropriate prefix based on binding metadata.
 * This is a fallback for expressions not processed by transformExpression (e.g., v-on handlers).
 * 
 * Uses a simple regex-based approach to find and prefix identifiers.
 * Handles common cases like: foo, foo.bar, foo = 'value', foo === bar
 */
function prefixIdentifiers(content: string, bindingMetadata: BindingMetadata = {}): string {
  // Keywords that should not be prefixed
  const jsKeywords = new Set([
    'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
    'this', 'arguments', 'window', 'document', 'console',
    'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Math', 'JSON', 'RegExp',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'typeof', 'instanceof', 'in', 'new', 'delete', 'void',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return',
    'function', 'class', 'const', 'let', 'var',
    '$event', '_ctx', '_cache', '_slots', '$props', '$setup', '$data', '$options'
  ]);
  
  // First, temporarily replace string literals to avoid matching inside them
  const stringPlaceholders: string[] = [];
  const contentWithPlaceholders = content.replace(/(['"`])(?:(?!\1|\\).|\\.)*\1/g, (match) => {
    stringPlaceholders.push(match);
    return `__STRING_PLACEHOLDER_${stringPlaceholders.length - 1}__`;
  });
  
  // Match identifiers: word boundaries, must start with letter or _ or $
  // Negative lookbehind for . to avoid prefixing property access
  // Negative lookahead for : to avoid prefixing object keys (but allow ::)
  const prefixed = contentWithPlaceholders.replace(/(?<![.\w$])([a-zA-Z_$][a-zA-Z0-9_$]*)(?![\w$])(?!\s*:(?!:))/g, (match, ident, offset) => {
    // Check if this is a keyword
    if (jsKeywords.has(ident)) {
      return match;
    }
    // Check if preceded by a dot (property access)
    if (offset > 0 && contentWithPlaceholders[offset - 1] === '.') {
      return match;
    }
    // Check if it's a placeholder
    if (ident.startsWith('__STRING_PLACEHOLDER_')) {
      return match;
    }
    return `${getIdentifierPrefix(ident, bindingMetadata)}${ident}`;
  });
  
  // Restore string literals
  return prefixed.replace(/__STRING_PLACEHOLDER_(\d+)__/g, (_, index) => {
    return stringPlaceholders[Number.parseInt(index, 10)] ?? '';
  });
}

/**
 * Generate code for an expression node.
 * Handles both simple expressions and compound expressions (from transformExpression).
 */
function genExpressionAsValue(node: ExpressionNode | undefined, context: CodegenContext): void {
  if (!node) {
    context.push('undefined');
    return;
  }
  
  if (node.type === NodeTypes.SIMPLE_EXPRESSION) {
    const simpleNode = node as SimpleExpressionNode;
    // If the expression is static (like string literals), output as-is
    // If it's dynamic and wasn't transformed to compound, we need to prefix identifiers
    if (simpleNode.isStatic) {
      context.push(simpleNode.content);
    } else {
      // Dynamic expression that wasn't transformed - prefix identifiers manually
      context.push(prefixIdentifiers(simpleNode.content, context.bindingMetadata));
    }
  } else if (node.type === NodeTypes.COMPOUND_EXPRESSION) {
    // Compound expression from transformExpression - concatenate all parts
    const compound = node as CompoundExpressionNode;
    for (const child of compound.children) {
      if (typeof child === 'string') {
        context.push(child);
      } else if (typeof child === 'symbol') {
        // Skip symbols (used for internal markers)
      } else if (child && typeof child === 'object' && 'type' in child) {
        if (child.type === NodeTypes.SIMPLE_EXPRESSION) {
          context.push((child as SimpleExpressionNode).content);
        } else {
          genExpressionAsValue(child as ExpressionNode, context);
        }
      }
    }
  }
}

/**
 * Generate code for an event handler expression.
 * Wraps inline statements in arrow functions, just like Vue does.
 * - Member expressions (handleClick, obj.method) are used as-is
 * - Function expressions (() => {}, $event => foo()) are used as-is  
 * - Inline statements (count++, foo()) are wrapped: $event => (count++)
 * - Multiple statements (foo(); bar()) are wrapped: $event => { foo(); bar() }
 */
function genEventHandler(node: ExpressionNode | undefined, context: CodegenContext): void {
  if (!node) {
    context.push('() => {}');
    return;
  }
  
  if (node.type === NodeTypes.SIMPLE_EXPRESSION) {
    const simpleNode = node as SimpleExpressionNode;
    if (simpleNode.isStatic) {
      // Static expression - shouldn't happen for event handlers, but handle it
      context.push(simpleNode.content);
    } else {
      // Dynamic expression - use wrapEventHandler to properly handle it
      context.push(wrapEventHandler(simpleNode.content, context));
    }
  } else if (node.type === NodeTypes.COMPOUND_EXPRESSION) {
    // Compound expression - extract the content and wrap if needed
    const compound = node as CompoundExpressionNode;
    const content = compound.children
      .map(child => {
        if (typeof child === 'string') {
          return child;
        } else if (child && typeof child === 'object' && 'type' in child) {
          if (child.type === NodeTypes.SIMPLE_EXPRESSION) {
            return (child as SimpleExpressionNode).content;
          }
        }
        return '';
      })
      .join('');
    context.push(wrapEventHandler(content, context));
  }
}

// Additional node types from Vue's transform phase
const TEXT_CALL = 12;
const VNODE_CALL = 13;
const JS_CALL_EXPRESSION = 14;

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
    case TEXT_CALL: {
      // TEXT_CALL wraps transformed text - extract and generate its content
      genTextCall(node, context);
      break;
    }
    case VNODE_CALL:
    case JS_CALL_EXPRESSION: {
      // These are generated by transformElement - we need to handle them
      // For now, fall back to the original node if available
      if (node.tag) {
        genElement(node, context);
      } else {
        context.push('null');
      }
      break;
    }
    default: {
      context.push('null');
    }
  }
}

/**
 * Generate code for TEXT_CALL nodes (created by transformText).
 * These wrap compound expressions for text content.
 */
function genTextCall(node: any, context: CodegenContext): void {
  if (node.content) {
    // TEXT_CALL has a content property which is usually a COMPOUND_EXPRESSION
    genNode(node.content, context);
  } else {
    context.push('null');
  }
}

/**
 * Generate code for element and component nodes
 */
export function genElement(node: ElementNode, context: CodegenContext): void {
  const { tag } = node;
  
  // Handle <slot> outlets specially
  if (tag === 'slot') {
    genSlotOutlet(node, context);
    return;
  }
  
  // Check if it's a component:
  // - Starts with uppercase (PascalCase components)
  // - Contains hyphen (kebab-case components like my-component)
  // Note: Web components also use hyphens but Vue treats them the same
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
 * Check if a component needs resolveComponent() call.
 * Components are resolved if they're not in the binding metadata (not imported).
 * Returns the variable/reference name to use for the component.
 */
function getComponentRef(tag: string, context: CodegenContext): string {
  // Convert tag to possible binding names (PascalCase and camelCase)
  const pascalName = tag.replace(/-./g, x => x[1]?.toUpperCase() ?? '').replace(/^./, x => x.toUpperCase());
  const camelName = pascalName.replace(/^./, x => x.toLowerCase());
  
  // Check if component is imported (in binding metadata)
  const isImported = context.bindingMetadata[tag] || 
                     context.bindingMetadata[pascalName] || 
                     context.bindingMetadata[camelName];
  
  if (isImported) {
    // Use the imported name directly
    return context.bindingMetadata[tag] ? tag : 
           context.bindingMetadata[pascalName] ? pascalName : camelName;
  }
  
  // Not imported - need resolveComponent
  // Generate variable name: _component_MyComponent or _component_my_component
  const varName = '_component_' + tag.replace(/-/g, '_');
  
  // Register for declaration if not already registered
  if (!context.components.has(tag)) {
    context.components.set(tag, varName);
    context.imports.add(genImport('vue', [{ name: 'resolveComponent', as: '_resolveComponent' }]));
  }
  
  return varName;
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
  const componentRef = getComponentRef(tag, context);
  
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
  context.push(`${componentRef}.__chunk`);
  context.push(', ');

  // 4. ExportName - access from component's __export property (set by build plugin)  
  context.push(`${componentRef}.__export`);
  context.push(', ');

  // 5. Slots - parse named slots from children
  genSlotsObject(children, context, false); // false = not as functions for client hydration
  
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
  const componentRef = getComponentRef(tag, context);
  
  // Add import for __serializeComponent
  context.imports.add(genImport('vue-onigiri/runtime/serialize', [{ name: 'serializeComponent', as: '__serializeComponent' }]));
  
  context.push(`__serializeComponent(${componentRef}, `);
  
  // Props
  if (props.length > 0) {
    genProps(props, context);
  } else {
    context.push('undefined');
  }
  context.push(', ');
  
  // Slots - parse named slots from children (as functions for SSR)
  genSlotsObject(children, context, true); // true = as functions for server-side rendering
  
  context.push(')');
}

/**
 * Generate code for <slot> outlets.
 * Slot outlets render content passed from parent components.
 * Format: __renderSlot(_ctx, _slots, name, props, fallback)
 * 
 * The __renderSlot helper will:
 * 1. Look up the slot by name in _slots
 * 2. Call the slot function with props if it exists
 * 3. Return the fallback content if no slot is provided
 */
function genSlotOutlet(node: ElementNode, context: CodegenContext): void {
  const { props, children } = node;
  
  // Add import for __renderSlot
  context.imports.add(genImport('vue-onigiri/runtime/render-slot', [{ name: 'renderSlot', as: '__renderSlot' }]));
  
  // Find the slot name from props (default is "default")
  let slotName = '"default"';
  const slotProps: (AttributeNode | DirectiveNode)[] = [];
  
  for (const prop of props) {
    if (prop.type === NodeTypes.ATTRIBUTE && prop.name === 'name') {
      slotName = prop.value ? `"${prop.value.content}"` : '"default"';
    } else {
      // All other props are passed to the slot
      slotProps.push(prop);
    }
  }
  
  context.push('__renderSlot(_ctx, _slots, ');
  context.push(slotName);
  context.push(', ');
  
  // Slot props (passed to scoped slots)
  if (slotProps.length > 0) {
    genProps(slotProps, context);
  } else {
    context.push('undefined');
  }
  context.push(', ');
  
  // Fallback content (children of the <slot> element)
  if (children.length > 0) {
    context.push('() => ');
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
  
  // Check if this is a void element (self-closing, no children allowed)
  const isVoidElement = VOID_ELEMENTS.has(tag);
  
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
  
  // 4. Children (void elements don't have children)
  if (!isVoidElement) {
    context.push(', ');
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
  ) as DirectiveNode | undefined;
  
  // Get all other props (not the v-bind object spread)
  const otherProps = props.filter(prop => 
    !(prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind' && !prop.arg)
  );
  
  if (bindDirective) {
    if (otherProps.length > 0) {
      // We have both v-bind object and other props - need to merge
      context.imports.add(genImport('vue', [{ name: 'mergeProps', as: '_mergeProps' }]));
      context.push('_mergeProps(');
      if (bindDirective.exp) {
        genExpressionAsValue(bindDirective.exp, context);
      } else {
        context.push('undefined');
      }
      context.push(', ');
      
      // Generate the other props object
      genPropsObject(otherProps, context);
      context.push(')');
    } else {
      // Only v-bind object, no other props
      if (bindDirective.exp) {
        genExpressionAsValue(bindDirective.exp, context);
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
        context.push(JSON.stringify(prop.value.content));
      } else {
        context.push('true');
      }
    } else if (prop.type === NodeTypes.DIRECTIVE) {
      // Skip structural directives - they're handled at node level
      if (prop.name === 'if' || prop.name === 'else' || prop.name === 'else-if' || 
          prop.name === 'for' || prop.name === 'slot') {
        continue;
      }
      
      if (!first) context.push(', ');
      first = false;
      
      // Handle v-on (events) - convert to onXxx format
      if (prop.name === 'on') {
        const eventName = (prop.arg && typeof prop.arg === 'object' && 'content' in prop.arg) 
          ? (prop.arg as SimpleExpressionNode).content 
          : '';
        // Convert event name to onXxx format (e.g., click -> onClick)
        const onEventName = 'on' + eventName.charAt(0).toUpperCase() + eventName.slice(1);
        context.push(`"${onEventName}": `);
        
        if (prop.exp) {
          genEventHandler(prop.exp, context);
        } else {
          context.push('() => {}');
        }
        continue;
      }
      
      // Handle v-bind with argument (:prop="value")
      if (prop.name === 'bind' && prop.arg) {
        const attrName = (typeof prop.arg === 'object' && 'content' in prop.arg) 
          ? (prop.arg as SimpleExpressionNode).content 
          : '';
        context.push(`"${attrName}": `);
        
        if (prop.exp) {
          genExpressionAsValue(prop.exp, context);
        } else {
          context.push('true');
        }
        continue;
      }
      
      // Other directives (v-show, v-model, custom directives)
      const attrName = (prop.arg && typeof prop.arg === 'object' && 'content' in prop.arg) 
        ? (prop.arg as SimpleExpressionNode).content 
        : prop.name;
      context.push(`"${attrName}": `);
      
      if (prop.exp) {
        genExpressionAsValue(prop.exp, context);
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
  // Use JSON.stringify to properly escape special characters
  context.push(JSON.stringify(node.content));
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
  genExpressionAsValue(node.content, context);
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
  
  for (const child of node.children) {
    if (typeof child === 'string') {
      // Operator strings like " + "
      context.push(child);
    } else if (typeof child === 'symbol') {
      // Skip symbols
    } else if (child && typeof child === 'object' && 'type' in child) {
      if (child.type === NodeTypes.TEXT) {
        // Text node - output as a quoted string
        context.push(JSON.stringify((child as TextNode).content));
      } else if (child.type === NodeTypes.INTERPOLATION) {
        genExpressionAsValue((child as InterpolationNode).content, context);
      } else if (child.type === NodeTypes.SIMPLE_EXPRESSION) {
        context.push((child as SimpleExpressionNode).content);
      } else if (child.type === NodeTypes.COMPOUND_EXPRESSION) {
        // Nested compound - generate just the inner expression
        context.push('(');
        for (const innerChild of (child as CompoundExpressionNode).children) {
          if (typeof innerChild === 'string') {
            context.push(innerChild);
          } else if (innerChild && typeof innerChild === 'object' && 'type' in innerChild) {
            if (innerChild.type === NodeTypes.TEXT) {
              context.push(JSON.stringify((innerChild as TextNode).content));
            } else if (innerChild.type === NodeTypes.SIMPLE_EXPRESSION) {
              context.push((innerChild as SimpleExpressionNode).content);
            }
          }
        }
        context.push(')');
      }
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
    genExpressionAsValue(firstBranch.condition, context);
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
 * Check if an expression node is a numeric literal.
 * Vue's v-for supports iterating over a number: `v-for="n in 3"` iterates 1, 2, 3
 */
function isNumericLiteral(node: ExpressionNode | undefined): boolean {
  if (!node) return false;
  if (node.type === NodeTypes.SIMPLE_EXPRESSION) {
    const content = (node as SimpleExpressionNode).content.trim();
    // Check if it's a valid numeric literal (integer or float)
    return /^-?\d+(\.\d+)?$/.test(content);
  }
  return false;
}

/**
 * Generate code for v-for nodes.
 * Outputs .map() array operations.
 * 
 * For numeric sources (e.g., `v-for="n in 3"`), wraps with Array.from
 * to create an iterable array [1, 2, 3].
 */
export function genFor(node: ForNode, context: CodegenContext): void {
  const { source, value, key, index } = node.parseResult;
  
  // Check if source is a numeric literal - needs special handling
  const isNumeric = isNumericLiteral(source);
  
  context.push('(');
  if (isNumeric) {
    // For numeric sources like `v-for="n in 3"`, create array [1, 2, ..., n]
    // Vue iterates from 1 to n (inclusive), so we use Array.from with 1-based values
    context.push('Array.from({length: ');
    genExpressionAsValue(source, context);
    context.push('}, (_, __i) => __i + 1)');
  } else {
    genExpressionAsValue(source, context);
  }
  context.push('.map((');
  context.push((value as SimpleExpressionNode)?.content || 'item');
  if (key) {
    context.push(', ');
    context.push((key as SimpleExpressionNode).content);
  }
  if (index) {
    context.push(', ');
    context.push((index as SimpleExpressionNode).content);
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
