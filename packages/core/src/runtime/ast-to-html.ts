import {
  createCommentVNode,
  createElementVNode,
  createStaticVNode,
  Fragment,
  Static,
  type VNode,
} from "vue";
import { ssrRenderAttrs } from "vue/server-renderer";
import { escapeHtml, escapeHtmlComment, isVoidTag } from "@vue/shared";
import {
  normalizeProps,
  renderClientComponent,
  renderMarkedSuspense,
  renderOnigiri,
  resolveOnigiriInput,
  type RenderOnigiriOptions,
} from "./deserialize";
import {
  countHtmlRootNodes,
  neutralizeCommentData,
  neutralizeHtmlComments,
  splitHtmlRootComments,
} from "./html";
import {
  encodeMarker,
  MARKER_COMPONENT,
  MARKER_COMPONENT_END,
  MARKER_SUSPENSE,
  MARKER_SUSPENSE_END,
  MARKER_TELEPORT,
  VServerComponentType,
  type OnigiriPayload,
  type VServerComponent,
} from "@vue-onigiri/shared";

type HtmlNode = VServerComponent | HtmlNode[] | string | null | undefined;

/** Render an island in the page's SSR tree, carrying client metadata in comments. */
export function renderOnigiriWithMarkers(
  input: VServerComponent | OnigiriPayload | undefined,
  options?: RenderOnigiriOptions,
): VNode | undefined {
  const ast = resolveOnigiriInput(input);
  if (!ast) return;
  const children = buildChildren(ast, options);
  return ast[0] === VServerComponentType.Fragment ||
    children.length > 1 ||
    (children[0]?.type === Static &&
      (children[0] as VNode & { staticCount: number }).staticCount > 1)
    ? createElementVNode(Fragment, null, children)
    : children[0];
}

/** Render marker-free AST content with Vue's SSR escaping and attribute rules. */
export function astToHtml(
  node: VServerComponent | VServerComponent[] | string | null | undefined,
): string {
  return renderHtml(node);
}

function renderHtml(node: HtmlNode): string {
  if (node == null) return "<!---->";
  if (typeof node === "string") return escapeHtml(node);
  if (typeof node[0] !== "number") return (node as HtmlNode[]).map(renderHtml).join("");
  const tuple = node as VServerComponent;
  switch (tuple[0]) {
    case VServerComponentType.Element: {
      const [, tag, props, children] = tuple;
      const open = `<${tag}${props ? ssrRenderAttrs(props, tag) : ""}>`;
      if (isVoidTag(tag)) return open;
      const content = props?.innerHTML
        ? neutralizeHtmlComments(props.innerHTML)
        : props?.textContent
          ? escapeHtml(props.textContent)
          : tag === "textarea" && props?.value
            ? escapeHtml(props.value)
            : children == null
              ? ""
              : renderHtml(children);
      return `${open}${content}</${tag}>`;
    }
    case VServerComponentType.Text:
      return escapeHtml(tuple[1]);
    case VServerComponentType.StaticHtml:
      return neutralizeHtmlComments(tuple[1]);
    case VServerComponentType.Comment:
      return `<!--${safeCommentData(tuple[1])}-->`;
    case VServerComponentType.Fragment:
      return tuple[1] ? renderHtml(tuple[1]) : "";
    case VServerComponentType.Suspense:
      if (!tuple[2]?.length) return tuple[1] ? renderHtml(tuple[1]) : "";
      throw new Error(
        "[vue-onigiri] astToHtml cannot render Suspense with a fallback; use renderOnigiriWithMarkers.",
      );
    default:
      throw new Error(
        `[vue-onigiri] astToHtml cannot render ${VServerComponentType[tuple[0]]}; use renderOnigiriWithMarkers.`,
      );
  }
}

function safeCommentData(data: string): string {
  return neutralizeCommentData(escapeHtmlComment(data));
}

function flatten(node: HtmlNode, result: (VServerComponent | string | null | undefined)[]): void {
  if (Array.isArray(node)) {
    if (typeof node[0] !== "number") {
      for (const child of node as HtmlNode[]) flatten(child, result);
      return;
    }
    const tuple = node as VServerComponent;
    if (
      tuple[0] === VServerComponentType.Fragment ||
      (tuple[0] === VServerComponentType.Suspense && !tuple[2]?.length)
    ) {
      if (tuple[1]) flatten(tuple[1], result);
      return;
    }
  }
  result.push(node as VServerComponent | string | null | undefined);
}

function hasMarkers(node: HtmlNode): boolean {
  if (node == null || typeof node === "string") return false;
  if (typeof node[0] !== "number") return (node as HtmlNode[]).some(hasMarkers);
  const tuple = node as VServerComponent;
  switch (tuple[0]) {
    case VServerComponentType.Component:
    case VServerComponentType.Teleport:
      return true;
    case VServerComponentType.Suspense:
      return !!tuple[2]?.length || hasMarkers(tuple[1]);
    case VServerComponentType.Fragment:
      return hasMarkers(tuple[1]);
    case VServerComponentType.Element:
      return (
        !isVoidTag(tuple[1]) &&
        !tuple[2]?.innerHTML &&
        !tuple[2]?.textContent &&
        !(tuple[1] === "textarea" && tuple[2]?.value) &&
        hasMarkers(tuple[3])
      );
    default:
      return false;
  }
}

function buildChildren(node: HtmlNode, options?: RenderOnigiriOptions): VNode[] {
  const nodes: (VServerComponent | string | null | undefined)[] = [];
  flatten(node, nodes);
  const children: VNode[] = [];
  let html = "";
  let count = 0;
  let previous: "text" | "static" | undefined;
  let recount = false;
  const flush = (): void => {
    if (html) children.push(createStaticVNode(html, recount ? countHtmlRootNodes(html) : count));
    html = "";
    count = 0;
    previous = undefined;
    recount = false;
  };

  const append = (
    content: string,
    kind: "text" | "static" | undefined,
    nodeCount: number,
  ): void => {
    if (!content) return;
    if ((kind === "static" && previous != null) || (kind === "text" && previous === "static"))
      recount = true;
    count += kind === "text" && previous === "text" ? 0 : nodeCount;
    html += content;
    previous = kind;
  };

  for (const child of nodes) {
    if (child == null || (Array.isArray(child) && child[0] === VServerComponentType.Comment)) {
      flush();
      children.push(createCommentVNode(safeCommentData(child?.[1] ?? "")));
    } else if (typeof child !== "string" && hasMarkers(child)) {
      flush();
      switch (child[0]) {
        case VServerComponentType.Element:
          children.push(
            createElementVNode(
              child[1],
              normalizeProps(child[2]),
              buildChildren(child[3] ?? [], options),
            ),
          );
          break;
        case VServerComponentType.Component:
          children.push(
            createCommentVNode(MARKER_COMPONENT + encodeMarker(child)),
            renderClientComponent(child, options),
            createCommentVNode(MARKER_COMPONENT_END),
          );
          break;
        case VServerComponentType.Teleport:
          children.push(
            createCommentVNode(MARKER_TELEPORT + encodeMarker(child)),
            renderOnigiri(child, options)!,
          );
          break;
        case VServerComponentType.Suspense:
          children.push(
            createCommentVNode(MARKER_SUSPENSE + encodeMarker([child[0], null, child[2]])),
            renderMarkedSuspense(buildChildren(child[1] ?? [], options), child[2], options),
            createCommentVNode(MARKER_SUSPENSE_END),
          );
          break;
      }
    } else {
      if (typeof child !== "string" && child[0] === VServerComponentType.StaticHtml) {
        const raw = neutralizeHtmlComments(child[1]);
        const parts: [string, boolean][] = raw.includes("<!--")
          ? splitHtmlRootComments(raw)
          : [[raw, false]];
        for (const [content, isComment] of parts) {
          if (isComment) {
            flush();
            children.push(createCommentVNode(safeCommentData(content)));
          } else {
            append(content, "static", parts.length === 1 ? child[2] : countHtmlRootNodes(content));
          }
        }
      } else {
        const kind =
          typeof child === "string" || child[0] === VServerComponentType.Text ? "text" : undefined;
        append(renderHtml(child), kind, 1);
      }
    }
  }
  flush();
  return children;
}
