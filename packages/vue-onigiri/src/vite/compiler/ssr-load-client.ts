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

interface PendingRoot {
  boundaries: PendingBoundary[];
  hasTeleport: boolean;
}

/**
 * Marks a directive as belonging to an SSR compile; survives Vue's clone into the vnode fallback branch.
 */
type TaggedDirective = DirectiveNode & { __onigiriSsr?: true };

const BOUNDARY_IDENTIFIER = "_onigiriClientBoundary";
const RENDER_IDENTIFIER = "_onigiriRenderClient";
const RENDER_VNODE_IDENTIFIER = "_onigiriRenderClientVNode";
const TELEPORT_IDENTIFIER = "_onigiriRenderTeleport";
const BOUNDARY_MODULE = "vue-onigiri/server";
const DIRECTIVE_NAME = "load-client";
/**
 * `when` is always emitted so Vue's appended `_scopeId` lands in a fixed position.
 */
const NO_BINDING = "undefined";

/**
 * Pending wraps per (sub)compilation root.
 */
const PENDING = new WeakMap<RootNode, PendingRoot>();

/**
 * Vue SSR node transform: a component carrying `v-load-client` renders through
 * `ssrRenderClientComponent` and a `<Teleport>` through the onigiri `ssrRenderTeleport`,
 * which write island markers around Vue's own output when the SSR context carries a nonce.
 * Client compiles only drop the directive. `onigiriCompilerPlugin` injects it into plugin-vue.
 */
export const ssrLoadClientTransform: NodeTransform = (node, context) => {
  if (node.type === NodeTypes.ROOT) {
    const pending: PendingRoot = {
      boundaries: [],
      hasTeleport: context.ssr && prepareSsrChildren(node.children),
    };
    PENDING.set(node, pending);
    // Vue sets the codegen node in its own exit hook, which runs before ours; the root exit runs last.
    return () => finishRoot(node, pending, context);
  }

  if (node.type !== NodeTypes.ELEMENT || node.tagType !== ElementTypes.COMPONENT) return;
  const index = node.props.findIndex(
    (prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === DIRECTIVE_NAME,
  );
  if (index === -1) return;
  const directive = node.props[index] as TaggedDirective;
  node.props.splice(index, 1);
  // Vue's slot fallback branch compiles with `ssr: false`; the tag tells it apart from a client build.
  if (!context.ssr && !directive.__onigiriSsr) return;
  PENDING.get(context.root)?.boundaries.push({ node, when: directive.exp });
};

/**
 * Tag `v-load-client` directives for the fallback branch and report whether a `<Teleport>` is present.
 */
function prepareSsrChildren(children: TemplateChildNode[]): boolean {
  let hasTeleport = false;
  for (const child of children) {
    if (child.type !== NodeTypes.ELEMENT) continue;
    if (child.tag === "Teleport" || child.tag === "teleport") hasTeleport = true;
    for (const prop of child.props) {
      if (prop.type === NodeTypes.DIRECTIVE && prop.name === DIRECTIVE_NAME) {
        (prop as TaggedDirective).__onigiriSsr = true;
      }
    }
    if (prepareSsrChildren(child.children)) hasTeleport = true;
  }
  return hasTeleport;
}

function finishRoot(root: RootNode, pending: PendingRoot, context: TransformContext): void {
  let used = false;
  for (const entry of pending.boundaries) {
    used = (context.ssr ? wrapSsrCall(entry) : wrapVNodeCall(entry)) || used;
  }
  if (pending.hasTeleport) {
    rewriteTeleportsOnCodegen(root);
    used = true;
  }
  // The fallback branch shares `imports` with the main pass, so the import is added once.
  if (used && !context.imports.some((item) => item.path === BOUNDARY_MODULE)) {
    context.imports.push({
      exp: createSimpleExpression(
        `{ OnigiriClientBoundary as ${BOUNDARY_IDENTIFIER}, ssrRenderClientComponent as ${RENDER_IDENTIFIER}, ` +
          `ssrRenderClientVNode as ${RENDER_VNODE_IDENTIFIER}, ssrRenderTeleport as ${TELEPORT_IDENTIFIER} }`,
        false,
      ),
      path: BOUNDARY_MODULE,
    });
  }
}

/**
 * Vue's SSR codegen builds the `_ssrRenderTeleport(...)` call after every node transform ran,
 * then assigns the root's codegen node; the setter swaps the callee at that point.
 */
function rewriteTeleportsOnCodegen(root: RootNode): void {
  let codegenNode = root.codegenNode;
  Object.defineProperty(root, "codegenNode", {
    configurable: true,
    enumerable: true,
    get: () => codegenNode,
    set(value: RootNode["codegenNode"]) {
      rewriteTeleportCalls(value, new WeakSet());
      codegenNode = value;
    },
  });
}

function rewriteTeleportCalls(node: unknown, seen: WeakSet<object>): void {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) rewriteTeleportCalls(item, seen);
    return;
  }
  const call = node as { type?: unknown; callee?: unknown };
  if (
    call.type === NodeTypes.JS_CALL_EXPRESSION &&
    typeof call.callee === "symbol" &&
    helperNameMap[call.callee] === "ssrRenderTeleport"
  ) {
    call.callee = TELEPORT_IDENTIFIER;
  }
  for (const key in node) {
    // Source locations and Babel expression ASTs never hold codegen nodes.
    if (key === "loc" || key === "ast") continue;
    rewriteTeleportCalls((node as Record<string, unknown>)[key], seen);
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

/**
 * Slot fallback branch: `_createVNode(comp, props, slots, patchFlag, dynamicProps)`.
 */
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
