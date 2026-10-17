import {
  createObjectExpression,
  createObjectProperty,
  createSimpleExpression,
  ElementTypes,
  helperNameMap,
  NodeTypes,
  type CallExpression,
  type DirectiveNode,
  type ElementNode,
  type ExpressionNode,
  type JSChildNode,
  type NodeTransform,
  type RootNode,
  type TemplateChildNode,
  type TransformContext,
  type VNodeCall,
} from "@vue/compiler-dom";

interface PendingBoundary {
  node: ElementNode & { ssrCodegenNode?: CallExpression };
  when: ExpressionNode | undefined;
}

/** Marks a directive as belonging to an SSR compile; survives Vue's clone into the vnode fallback branch. */
type TaggedDirective = DirectiveNode & { __onigiriSsr?: true };

const BOUNDARY_IDENTIFIER = "_onigiriClientBoundary";
const RENDER_IDENTIFIER = "_onigiriRenderClient";
const RENDER_VNODE_IDENTIFIER = "_onigiriRenderClientVNode";
const BOUNDARY_MODULE = "@vue-onigiri/core/runtime/ssr-boundary";
const DIRECTIVE_NAME = "load-client";
/** `when` is always emitted so Vue's appended `_scopeId` lands in a fixed position. */
const NO_BINDING = "undefined";

/** Pending wraps per (sub)compilation root. */
const PENDING = new WeakMap<RootNode, PendingBoundary[]>();

/**
 * Vue SSR node transform: a component carrying `v-load-client` renders through
 * `ssrRenderClientComponent`, which writes island markers around Vue's own output
 * when the SSR context carries a nonce and is Vue's own call otherwise.
 * Safe to pass globally in `compilerOptions.nodeTransforms`; inert in client compiles.
 */
export const ssrLoadClientTransform: NodeTransform = (node, context) => {
  if (node.type === NodeTypes.ROOT) {
    if (context.ssr) tagDirectives(node.children);
    const pending: PendingBoundary[] = [];
    PENDING.set(node, pending);
    // Vue sets the codegen node in its own exit hook, which runs before ours; the root exit runs last.
    return () => {
      if (pending.length > 0) wrapPending(pending, context);
    };
  }

  if (node.type !== NodeTypes.ELEMENT || node.tagType !== ElementTypes.COMPONENT) return;
  const index = node.props.findIndex(
    (prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === DIRECTIVE_NAME,
  );
  if (index === -1) return;
  const directive = node.props[index] as TaggedDirective;
  // Vue's slot fallback branch compiles with `ssr: false`; the tag tells it apart from a client build.
  if (!context.ssr && !directive.__onigiriSsr) return;
  node.props.splice(index, 1);
  PENDING.get(context.root)?.push({ node, when: directive.exp });
};

function tagDirectives(children: TemplateChildNode[]): void {
  for (const child of children) {
    if (child.type !== NodeTypes.ELEMENT) continue;
    for (const prop of child.props) {
      if (prop.type === NodeTypes.DIRECTIVE && prop.name === DIRECTIVE_NAME) {
        (prop as TaggedDirective).__onigiriSsr = true;
      }
    }
    tagDirectives(child.children);
  }
}

function wrapPending(pending: PendingBoundary[], context: TransformContext): void {
  let wrapped = false;
  for (const entry of pending) {
    wrapped = (context.ssr ? wrapSsrCall(entry) : wrapVNodeCall(entry)) || wrapped;
  }
  // The fallback branch shares `imports` with the main pass, so the import is added once.
  if (wrapped && !context.imports.some((item) => item.path === BOUNDARY_MODULE)) {
    context.imports.push({
      exp: createSimpleExpression(
        `{ OnigiriClientBoundary as ${BOUNDARY_IDENTIFIER}, ssrRenderClientComponent as ${RENDER_IDENTIFIER}, ssrRenderClientVNode as ${RENDER_VNODE_IDENTIFIER} }`,
        false,
      ),
      path: BOUNDARY_MODULE,
    });
  }
}

function wrapSsrCall({ node, when }: PendingBoundary): boolean {
  const call = node.ssrCodegenNode;
  if (!call || call.type !== NodeTypes.JS_CALL_EXPRESSION) return false;
  const callee = typeof call.callee === "symbol" ? helperNameMap[call.callee] : call.callee;
  // `_ssrRenderComponent(comp, props, slots, _parent)` becomes the same-shaped helper call.
  if (callee === "ssrRenderComponent") {
    call.callee = RENDER_IDENTIFIER;
    call.arguments.push(when ?? NO_BINDING);
    return true;
  }
  // `_ssrRenderVNode(_push, _createVNode(comp, props, slots), _parent)` becomes the statement twin.
  if (callee === "ssrRenderVNode") {
    const [push, vnode] = call.arguments as [string, CallExpression];
    call.callee = RENDER_VNODE_IDENTIFIER;
    call.arguments = [push, ...vnode.arguments, "_parent", when ?? NO_BINDING];
    return true;
  }
  return false;
}

/** Slot fallback branch: `_createVNode(comp, props, slots, patchFlag, dynamicProps)`. */
function wrapVNodeCall({ node, when }: PendingBoundary): boolean {
  const call = node.codegenNode as VNodeCall | undefined;
  if (!call || call.type !== NodeTypes.VNODE_CALL) return false;
  call.props = boundaryProps(call.tag as JSChildNode | string, call.props ?? "null", when);
  call.tag = BOUNDARY_IDENTIFIER;
  call.patchFlag = undefined;
  call.dynamicProps = undefined;
  return true;
}

function boundaryProps(
  component: JSChildNode | string,
  props: JSChildNode | string,
  when: ExpressionNode | undefined,
) {
  const properties = [
    createObjectProperty("is", asNode(component)),
    createObjectProperty("props", asNode(props)),
  ];
  if (when) properties.push(createObjectProperty("when", when));
  return createObjectExpression(properties);
}

function asNode(value: JSChildNode | string): JSChildNode {
  return typeof value === "string" ? createSimpleExpression(value, false) : value;
}
