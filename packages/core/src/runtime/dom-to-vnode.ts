import {
  createCommentVNode,
  createElementVNode,
  createStaticVNode,
  Fragment,
  isVNode,
  Static,
  type VNode,
} from "vue";
import { escapeHtml } from "@vue/shared";
import {
  normalizeProps,
  renderClientComponent,
  renderMarkedSuspense,
  renderOnigiri,
  type RenderOnigiriOptions,
} from "./deserialize";
import {
  decodeMarker,
  MARKER_COMPONENT,
  MARKER_COMPONENT_END,
  MARKER_SUSPENSE,
  MARKER_SUSPENSE_END,
  MARKER_TELEPORT,
  type VServerComponent,
  type VServerComponentComponent,
} from "./shared";

/** Options for rebuilding an island VNode tree from existing HTML. */
export interface DomToVNodeOptions extends RenderOnigiriOptions {
  /** Static runs adopt the live DOM (empty children string). Set false when the DOM is detached, e.g. parsed from a fetched HTML string. */
  adopt?: boolean;
  /** Tree currently rendered for this island; reuse unchanged static runs by identity. Without it, every run is replaced. */
  previous?: VNode;
}

const COMMENT_NODE = 8;
const ELEMENT_NODE = 1;
const FRAGMENT_END = "]";
const FRAGMENT_START = "[";
const SHOW_COMMENT = 128;
const TELEPORT_END = "teleport end";
const TELEPORT_START = "teleport start";
const TEXT_NODE = 3;
const VNODE_RESERVED_ATTRIBUTES = new Set(["key", "ref", "ref_for", "ref_key"]);
let STATIC_RUN_ID = 0;

interface WalkContext {
  adopt: boolean;
  markerAncestors: Set<Node>;
  options: DomToVNodeOptions;
  previousRuns?: Map<string, VNode[]>;
}

interface MarkerResult {
  next: ChildNode | null;
  vnodes: VNode[];
}

/** Rebuild a hydratable VNode tree from the island root DOM node. */
export function domToVNode(start: Node, options: DomToVNodeOptions = {}): VNode | undefined {
  const context = createWalkContext(start, options);
  const vnodes = walkRootNode(start, context);
  return wrapRoot(vnodes);
}

/** Parse marked HTML for updates; pass the currently rendered tree to preserve unchanged static runs. */
export function htmlToVNode(html: string, options: DomToVNodeOptions = {}): VNode | undefined {
  const template = document.createElement("template");
  template.innerHTML = html;
  const childNodes = template.content.childNodes;
  const parsedOptions = { ...options, adopt: false };

  if (childNodes.length === 0) return;
  if (childNodes.length === 1 && childNodes[0]) return domToVNode(childNodes[0], parsedOptions);

  const context = createWalkContextForScope(template.content, template.content, parsedOptions);
  const children = walkSiblings(template.content.firstChild, null, context);
  if (children.length === 1 && children[0]?.type === Fragment) return children[0];
  return createElementVNode(Fragment, null, children);
}

function createWalkContext(start: Node, options: DomToVNodeOptions): WalkContext {
  if (isFragmentStart(start)) {
    const parent = start.parentNode;
    return createWalkContextForScope(parent ?? start, parent ?? null, options);
  }

  const scope = start.nodeType === ELEMENT_NODE ? start : (start.parentNode ?? start);
  return createWalkContextForScope(scope, start.parentNode, options);
}

function createWalkContextForScope(
  scopeRoot: Node,
  islandParent: Node | null,
  options: DomToVNodeOptions,
): WalkContext {
  return {
    adopt: options.adopt ?? true,
    markerAncestors: collectMarkerAncestors(scopeRoot, islandParent),
    options,
    previousRuns:
      options.adopt === false && options.previous ? collectStaticRuns(options.previous) : undefined,
  };
}

function collectMarkerAncestors(scopeRoot: Node, islandParent: Node | null): Set<Node> {
  const ancestors = new Set<Node>();
  const ownerDocument = scopeRoot.ownerDocument ?? document;
  const treeWalker = ownerDocument.createTreeWalker(scopeRoot, SHOW_COMMENT);

  for (let current = treeWalker.nextNode(); current; current = treeWalker.nextNode()) {
    if (!isMarkerComment(current)) continue;

    for (let ancestor = current.parentNode; ancestor && ancestor !== islandParent;) {
      if (ancestor.nodeType === ELEMENT_NODE) ancestors.add(ancestor);
      ancestor = ancestor.parentNode;
    }
  }

  return ancestors;
}

function walkRootNode(start: Node, context: WalkContext): VNode[] {
  if (isFragmentStart(start)) {
    const end = findFragmentEnd(start);
    const children = walkSiblings(start.nextSibling, end, context);
    return [createElementVNode(Fragment, null, children)];
  }

  if (isMarkerComment(start)) return handleMarkerComment(start as Comment, context).vnodes;

  if (start.nodeType === COMMENT_NODE) return [createCommentVNode((start as Comment).data)];
  if (start.nodeType === ELEMENT_NODE && context.markerAncestors.has(start)) {
    return [walkMarkerAncestorElement(start as Element, context)];
  }
  if (isStaticNode(start)) return [createStaticRun([start], context)];
  return [];
}

function walkSiblings(first: ChildNode | null, stop: Node | null, context: WalkContext): VNode[] {
  const vnodes: VNode[] = [];
  const staticRun: Node[] = [];

  const flushStaticRun = (): void => {
    if (staticRun.length === 0) return;
    vnodes.push(createStaticRun(staticRun, context));
    staticRun.length = 0;
  };

  for (let current = first; current && current !== stop;) {
    if (isFragmentStart(current)) {
      flushStaticRun();
      const end = findFragmentEnd(current);
      vnodes.push(
        createElementVNode(Fragment, null, walkSiblings(current.nextSibling, end, context)),
      );
      current = end.nextSibling;
      continue;
    }

    if (isMarkerComment(current)) {
      flushStaticRun();
      const result = handleMarkerComment(current as Comment, context);
      vnodes.push(...result.vnodes);
      current = result.next;
      continue;
    }

    if (current.nodeType === COMMENT_NODE) {
      flushStaticRun();
      vnodes.push(createCommentVNode((current as Comment).data));
      current = current.nextSibling;
      continue;
    }

    if (current.nodeType === ELEMENT_NODE && context.markerAncestors.has(current)) {
      flushStaticRun();
      vnodes.push(walkMarkerAncestorElement(current as Element, context));
      current = current.nextSibling;
      continue;
    }

    if (isStaticNode(current)) {
      staticRun.push(current);
      current = current.nextSibling;
      continue;
    }

    current = current.nextSibling;
  }

  flushStaticRun();
  return vnodes;
}

function walkMarkerAncestorElement(element: Element, context: WalkContext): VNode {
  return createElementVNode(
    element.localName,
    normalizeProps(readAttributes(element)),
    walkSiblings(element.firstChild, null, context),
  );
}

function handleMarkerComment(comment: Comment, context: WalkContext): MarkerResult {
  const data = comment.data;
  const plain: MarkerResult = { next: comment.nextSibling, vnodes: [createCommentVNode(data)] };

  if (hasMarkerPrefix(data, MARKER_COMPONENT)) {
    const tuple = tryDecodeMarker<VServerComponentComponent>(data.slice(MARKER_COMPONENT.length));
    if (!tuple) return plain;
    return {
      next: findClosingMarker(comment, MARKER_COMPONENT, MARKER_COMPONENT_END).nextSibling,
      vnodes: [
        createCommentVNode(data),
        renderClientComponent(tuple, context.options),
        createCommentVNode(MARKER_COMPONENT_END),
      ],
    };
  }

  if (hasMarkerPrefix(data, MARKER_TELEPORT)) {
    const tuple = tryDecodeMarker<VServerComponent>(data.slice(MARKER_TELEPORT.length));
    if (!tuple) return plain;
    const teleportVNode = renderOnigiri(tuple, context.options);
    return {
      next: findTeleportEnd(comment).nextSibling,
      vnodes: teleportVNode
        ? [createCommentVNode(data), teleportVNode]
        : [createCommentVNode(data)],
    };
  }

  if (hasMarkerPrefix(data, MARKER_SUSPENSE)) {
    const tuple = tryDecodeMarker<[number, null, VServerComponent[] | undefined]>(
      data.slice(MARKER_SUSPENSE.length),
    );
    if (!tuple) return plain;
    const fragmentStart = requireImmediateFragmentStart(comment);
    const fragmentEnd = findFragmentEnd(fragmentStart);
    const children = walkSiblings(fragmentStart.nextSibling, fragmentEnd, context);
    return {
      next: findClosingMarker(comment, MARKER_SUSPENSE, MARKER_SUSPENSE_END).nextSibling,
      vnodes: [
        createCommentVNode(data),
        renderMarkedSuspense(children, tuple[2], context.options),
        createCommentVNode(MARKER_SUSPENSE_END),
      ],
    };
  }

  return plain;
}

function tryDecodeMarker<T>(json: string): T | undefined {
  try {
    return decodeMarker<T>(json);
  } catch {
    return;
  }
}

function findClosingMarker(start: Comment, openMarker: string, closeMarker: string): Comment {
  let depth = 0;
  for (let current = start.nextSibling; current; current = current.nextSibling) {
    if (current.nodeType !== COMMENT_NODE) continue;
    const data = (current as Comment).data;
    if (hasMarkerPrefix(data, openMarker)) {
      depth++;
    } else if (data === closeMarker) {
      if (depth === 0) return current as Comment;
      depth--;
    }
  }
  throw new Error(`[vue-onigiri] Missing closing marker: ${closeMarker}`);
}

function findTeleportEnd(start: Comment): Comment {
  let depth = 0;
  for (let current = start.nextSibling; current; current = current.nextSibling) {
    if (current.nodeType !== COMMENT_NODE) continue;
    const data = (current as Comment).data;
    if (data === TELEPORT_START) {
      depth++;
    } else if (data === TELEPORT_END) {
      depth--;
      if (depth === 0) return current as Comment;
    }
  }
  throw new Error("[vue-onigiri] Missing teleport end marker");
}

function requireImmediateFragmentStart(start: Comment): Comment {
  const next = start.nextSibling;
  if (next && isFragmentStart(next)) return next as Comment;
  throw new Error("[vue-onigiri] Suspense marker must be followed by a fragment start anchor");
}

function findFragmentEnd(start: Node): Comment {
  let depth = 0;
  for (let current = start.nextSibling; current; current = current.nextSibling) {
    if (current.nodeType !== COMMENT_NODE) continue;
    const data = (current as Comment).data;
    if (data === FRAGMENT_START) {
      depth++;
    } else if (data === FRAGMENT_END) {
      if (depth === 0) return current as Comment;
      depth--;
    }
  }
  throw new Error("[vue-onigiri] Missing fragment end marker");
}

function collectStaticRuns(previous: VNode): Map<string, VNode[]> {
  const runs = new Map<string, VNode[]>();
  const visit = (vnode: VNode): void => {
    if (vnode.type === Static) {
      const html = vnode.children as string;
      const matches = runs.get(html);
      if (matches) matches.push(vnode);
      else runs.set(html, [vnode]);
    } else if (
      (vnode.type === Fragment || typeof vnode.type === "string") &&
      Array.isArray(vnode.children)
    ) {
      for (const child of vnode.children) {
        if (isVNode(child)) visit(child);
      }
    }
  };
  visit(previous);
  return runs;
}

function createStaticRun(nodes: Node[], context: WalkContext): VNode {
  const html = context.adopt ? "" : nodes.map(serializeStaticNode).join("");
  const previous = context.adopt ? undefined : context.previousRuns?.get(html)?.shift();
  if (previous) return previous;
  const vnode = createStaticVNode(html, nodes.length);
  // Production Vue never transfers DOM anchors between distinct Static vnodes.
  vnode.key = ++STATIC_RUN_ID;
  // Vue clones mounted children and reconstructs their keys from props.
  vnode.props = { key: vnode.key };
  return vnode;
}

function serializeStaticNode(node: Node): string {
  if (node.nodeType === ELEMENT_NODE) return (node as Element).outerHTML;
  if (node.nodeType === TEXT_NODE) return escapeHtml((node as Text).data);
  return "";
}

function readAttributes(element: Element): Record<string, string> | undefined {
  let props: Record<string, string> | undefined;
  for (const name of element.getAttributeNames()) {
    if (VNODE_RESERVED_ATTRIBUTES.has(name)) continue;
    (props ??= {})[name] = element.getAttribute(name) ?? "";
  }
  return props;
}

function isMarkerComment(node: Node): boolean {
  if (node.nodeType !== COMMENT_NODE) return false;
  const data = (node as Comment).data;
  return (
    hasMarkerPrefix(data, MARKER_COMPONENT) ||
    hasMarkerPrefix(data, MARKER_TELEPORT) ||
    hasMarkerPrefix(data, MARKER_SUSPENSE)
  );
}

function isFragmentStart(node: Node): boolean {
  return node.nodeType === COMMENT_NODE && (node as Comment).data === FRAGMENT_START;
}

function isStaticNode(node: Node): boolean {
  return node.nodeType === ELEMENT_NODE || node.nodeType === TEXT_NODE;
}

function hasMarkerPrefix(data: string, marker: string): boolean {
  return data.startsWith(`${marker}[`);
}

function wrapRoot(vnodes: VNode[]): VNode | undefined {
  if (vnodes.length === 0) return;
  if (vnodes.length === 1) return vnodes[0];
  return createElementVNode(Fragment, null, vnodes);
}
