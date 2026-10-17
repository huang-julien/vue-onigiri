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
  createMarkerSet,
  decodeMarker,
  type MarkerSet,
  type VServerComponent,
  type VServerComponentComponent,
} from "@vue-onigiri/shared";

/** Options for rebuilding an island VNode tree from existing HTML. */
export interface DomToVNodeOptions extends RenderOnigiriOptions {
  /** Static runs adopt the live DOM (empty children string). Set false when the DOM is detached, e.g. parsed from a fetched HTML string. */
  adopt?: boolean;
  /** Tree currently rendered for this island; static runs whose DOM is unchanged keep their VNode. Without it, every run is replaced. */
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
  /** Only comments carrying these prefixes are markers; with a nonce, legacy prefixes are plain comments. */
  markers: MarkerSet;
  options: DomToVNodeOptions;
  previousRuns?: Map<string, VNode[]>;
  /** Static runs carry their HTML instead of parsed nodes to clone. */
  serialize?: boolean;
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
  const { content } = parseHtml(html);
  if (!content.firstChild) return;
  const context = createWalkContextForScope(content, content, { ...options, adopt: false });
  if (content.childNodes.length === 1) return wrapRoot(walkRootNode(content.firstChild, context));
  const children = walkSiblings(content.firstChild, null, context);
  if (children.length === 1 && children[0]?.type === Fragment) return children[0];
  return createElementVNode(Fragment, null, children);
}

/**
 * Parse marked HTML into sibling VNodes for slot content: the parent renders the anchors,
 * and each static run carries its HTML so one VNode can hydrate or mount, then be cloned.
 */
export function htmlToVNodes(html: string, options: DomToVNodeOptions = {}): VNode[] {
  const { content } = parseHtml(html);
  if (!content.firstChild) return [];
  const context = createWalkContextForScope(content, content, { ...options, adopt: false });
  context.serialize = true;
  return walkSiblings(content.firstChild, null, context);
}

function parseHtml(html: string): HTMLTemplateElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template;
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
  const markers = createMarkerSet(options.nonce);
  return {
    adopt: options.adopt ?? true,
    markerAncestors: collectMarkerAncestors(scopeRoot, islandParent, markers),
    markers,
    options,
    previousRuns:
      options.adopt === false && options.previous ? collectStaticRuns(options.previous) : undefined,
  };
}

function collectMarkerAncestors(
  scopeRoot: Node,
  islandParent: Node | null,
  markers: MarkerSet,
): Set<Node> {
  const ancestors = new Set<Node>();
  const ownerDocument = scopeRoot.ownerDocument ?? document;
  const treeWalker = ownerDocument.createTreeWalker(scopeRoot, SHOW_COMMENT);

  for (let current = treeWalker.nextNode(); current; current = treeWalker.nextNode()) {
    if (!isMarkerComment(current, markers)) continue;

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

  if (isMarkerComment(start, context.markers)) {
    return handleMarkerComment(start as Comment, context).vnodes;
  }

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

    if (isMarkerComment(current, context.markers)) {
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
  const markers = context.markers;
  const plain: MarkerResult = { next: comment.nextSibling, vnodes: [createCommentVNode(data)] };

  if (hasMarkerPrefix(data, markers.component)) {
    const tuple = tryDecodeMarker<VServerComponentComponent>(data.slice(markers.component.length));
    if (!tuple) return plain;
    return {
      next: findClosingMarker(comment, markers.component, markers.componentEnd).nextSibling,
      vnodes: [
        createCommentVNode(data),
        renderClientComponent(tuple, context.options),
        createCommentVNode(markers.componentEnd),
      ],
    };
  }

  if (hasMarkerPrefix(data, markers.teleport)) {
    const tuple = tryDecodeMarker<VServerComponent>(data.slice(markers.teleport.length));
    if (!tuple) return plain;
    const teleportVNode = renderOnigiri(tuple, context.options);
    return {
      next: findTeleportEnd(comment).nextSibling,
      vnodes: teleportVNode
        ? [createCommentVNode(data), teleportVNode]
        : [createCommentVNode(data)],
    };
  }

  if (hasMarkerPrefix(data, markers.suspense)) {
    const tuple = tryDecodeMarker<[number, null, VServerComponent[] | undefined]>(
      data.slice(markers.suspense.length),
    );
    if (!tuple) return plain;
    const fragmentStart = requireImmediateFragmentStart(comment);
    const fragmentEnd = findFragmentEnd(fragmentStart);
    const children = walkSiblings(fragmentStart.nextSibling, fragmentEnd, context);
    return {
      next: findClosingMarker(comment, markers.suspense, markers.suspenseEnd).nextSibling,
      vnodes: [
        createCommentVNode(data),
        renderMarkedSuspense(children, tuple[2], context.options),
        createCommentVNode(markers.suspenseEnd),
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
      // A run that was never mounted or hydrated has no DOM to compare against.
      if (!vnode.el) return;
      const key = staticRunKey(
        vnode.el as Node,
        (vnode as VNode & { staticCount: number }).staticCount,
      );
      const matches = runs.get(key);
      if (matches) matches.push(vnode);
      else runs.set(key, [vnode]);
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
  const previous = context.previousRuns ? findPreviousRun(nodes, context.previousRuns) : undefined;
  if (previous) return previous;
  const vnode = createStaticVNode("", nodes.length);
  // Production Vue never transfers DOM anchors between distinct Static vnodes.
  vnode.key = ++STATIC_RUN_ID;
  // Vue clones mounted children and reconstructs their keys from props.
  vnode.props = { key: vnode.key };
  if (context.serialize) {
    // Carrying the HTML lets the same VNode mount or hydrate once and be cloned on later renders.
    vnode.children = nodes.map(serializeStaticNode).join("");
  } else if (!context.adopt) {
    // With anchors set, Vue clones the parsed nodes at mount instead of parsing the HTML again.
    vnode.el = nodes[0]!;
    vnode.anchor = nodes[nodes.length - 1]!;
  }
  return vnode;
}

function serializeStaticNode(node: Node): string {
  if (node.nodeType === ELEMENT_NODE) return (node as Element).outerHTML;
  if (node.nodeType === TEXT_NODE) return escapeHtml((node as Text).data);
  return "";
}

function findPreviousRun(nodes: Node[], runs: Map<string, VNode[]>): VNode | undefined {
  const candidates = runs.get(staticRunKey(nodes[0]!, nodes.length));
  if (!candidates) return;
  const index = candidates.findIndex((run) => sameStaticRun(nodes, run.el as Node));
  if (index === -1) return;
  return candidates.splice(index, 1)[0];
}

function sameStaticRun(nodes: Node[], first: Node): boolean {
  let current: Node | null = first;
  for (const node of nodes) {
    if (!current || !node.isEqualNode(current)) return false;
    current = current.nextSibling;
  }
  return true;
}

function staticRunKey(first: Node, count: number): string {
  return `${count}:${first.nodeName}`;
}

function readAttributes(element: Element): Record<string, string> | undefined {
  let props: Record<string, string> | undefined;
  for (const name of element.getAttributeNames()) {
    if (VNODE_RESERVED_ATTRIBUTES.has(name)) continue;
    (props ??= {})[name] = element.getAttribute(name) ?? "";
  }
  return props;
}

function isMarkerComment(node: Node, markers: MarkerSet): boolean {
  if (node.nodeType !== COMMENT_NODE) return false;
  const data = (node as Comment).data;
  return (
    hasMarkerPrefix(data, markers.component) ||
    hasMarkerPrefix(data, markers.teleport) ||
    hasMarkerPrefix(data, markers.suspense)
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
