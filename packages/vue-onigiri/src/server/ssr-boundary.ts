import {
  createVNode,
  defineComponent,
  getCurrentInstance,
  popScopeId,
  pushScopeId,
  ssrContextKey,
  type Component,
  type ComponentInternalInstance,
  type VNode,
  // @ts-expect-error ssrUtils is not a public API
  ssrUtils,
} from "vue";
import {
  ssrRenderComponent,
  ssrRenderTeleport as vueSsrRenderTeleport,
  ssrRenderVNode,
} from "vue/server-renderer";
import { isPromise } from "@vue/shared";
import {
  COMPONENT_MARKER_TYPE,
  createMarkerSet,
  type MarkerSet,
  type OnigiriComponentMarker,
  type OnigiriTeleportMarker,
} from "../shared/markers";
import { createMarkerNonce, encodeMarker } from "./markers";

/**
 * Chunk reference the Vite plugin attaches to every SFC it compiles, read when marking it.
 */
export interface OnigiriDescriptor {
  /**
   * Chunk the client imports the component from, a root-relative source path, package specifier or baked URL.
   */
  chunk: string;
  /**
   * Export of that chunk holding the component.
   *
   * @default "default"
   */
  export?: string;
}

/**
 * Props the SSR transform hands the boundary in place of the `v-load-client` component.
 */
interface ClientBoundaryProps {
  /**
   * Component the island renders on the server and the client reloads.
   */
  is: Component | string;
  /**
   * Props of that component; listeners are dropped from the marker.
   */
  props?: Record<string, any> | null;
  /**
   * The `v-load-client` binding; `false` renders the component inline without markers.
   */
  when?: unknown;
}

type SSRBufferItem = string | SSRBuffer | Promise<SSRBuffer>;
type SSRBuffer = SSRBufferItem[] & { hasAsync?: boolean };
type PushFn = (item: SSRBufferItem) => void;
type SSRSlot = (
  props: Record<string, unknown>,
  push?: PushFn,
  parent?: ComponentInternalInstance,
  scopeId?: string | null,
) => unknown;
type SSRSlots = Record<string, SSRSlot>;
type MaybePromise<T> = T | Promise<T>;

/**
 * Key under which the SSR context carries the marker nonce of the current render.
 */
export const ONIGIRI_NONCE_KEY = "onigiriNonce";

/**
 * VNodes of marked client components; their own templates never write teleport markers.
 */
const CLIENT_VNODES = new WeakSet<VNode>();

/**
 * Give an SSR context the nonce the markers bind to, keeping one already set.
 */
export function provideMarkerNonce<T extends Record<string, any>>(
  context: T,
): T & { [ONIGIRI_NONCE_KEY]: string } {
  (context as Record<string, any>)[ONIGIRI_NONCE_KEY] ??= createMarkerNonce();
  return context as T & { [ONIGIRI_NONCE_KEY]: string };
}

/**
 * Render a `v-load-client` component with Vue's SSR renderer and wrap its
 * output in island markers. The SSR transform emits this in place of
 * `ssrRenderComponent`, same shape plus `when`; Vue appends the slot scope id last.
 * Outside an island render (no nonce in the SSR context) it is Vue's own call.
 */
export function ssrRenderClientComponent(
  is: Component | string,
  props: Record<string, any> | null | undefined,
  slots: SSRSlots | null | undefined,
  parent: ComponentInternalInstance,
  when?: unknown,
  slotScopeId?: string,
): SSRBuffer | Promise<SSRBuffer> {
  if (typeof is === "string") {
    const buffer: SSRBuffer = [];
    ssrRenderVNode((item) => buffer.push(item), createVNode(is, props, slots), parent, slotScopeId);
    return buffer;
  }

  const markers = when === false ? undefined : markersOf(parent);
  if (!markers) {
    return ssrRenderComponent(
      is,
      props,
      slots as Parameters<typeof ssrRenderComponent>[2],
      parent,
      slotScopeId,
    ) as SSRBuffer | Promise<SSRBuffer>;
  }

  const { chunk, exportName } = describeComponent(is);
  const captured: Record<string, SSRBuffer> = {};
  // Same as `ssrRenderComponent`, but holding the vnode tells its subtree apart.
  const vnode = createVNode(is, props, captureSlots(slots, captured, parent));
  CLIENT_VNODES.add(vnode);
  const buffer: SSRBuffer = [];
  ssrRenderVNode((item) => buffer.push(item), vnode, parent, slotScopeId);

  return chain(unroll(buffer), (html) =>
    chain(unrollRecord(captured), (slotHtml): SSRBuffer => {
      const tuple: OnigiriComponentMarker = [
        COMPONENT_MARKER_TYPE,
        withoutListeners(props),
        chunk,
        exportName,
      ];
      if (slotHtml) tuple.push(slotHtml);
      return [
        `<!--${markers.component}${encodeMarker(tuple)}-->`,
        html,
        `<!--${markers.componentEnd}-->`,
      ];
    }),
  );
}

/**
 * Statement form of `ssrRenderClientComponent` with the shape of Vue's
 * `ssrRenderVNode` call site, for dynamic components: `_push` first, `when`
 * after `_parent`, and Vue's appended slot scope id last.
 */
export function ssrRenderClientVNode(
  push: PushFn,
  is: Component | string,
  props: Record<string, any> | null | undefined,
  slots: SSRSlots | null | undefined,
  parent: ComponentInternalInstance,
  when?: unknown,
  slotScopeId?: string,
): void {
  push(ssrRenderClientComponent(is, props, slots, parent, when, slotScopeId));
}

/**
 * Vue's `ssrRenderTeleport`, writing an `o:t` marker with the target, the
 * disabled flag and the content HTML before Vue's own output. The SSR
 * transform emits it in place of Vue's call; it is Vue's call outside an island render.
 */
export function ssrRenderTeleport(
  parentPush: PushFn,
  contentRenderFn: (push: PushFn) => void,
  target: string,
  disabled: boolean,
  parentComponent: ComponentInternalInstance,
): void {
  const markers = markersOf(parentComponent);
  // The owner is the instance whose template holds the call, slot content included.
  if (!markers || insideClientComponent(getCurrentInstance())) {
    vueSsrRenderTeleport(parentPush, contentRenderFn, target, disabled, parentComponent);
    return;
  }
  const open = (html?: string): string => {
    const tuple: OnigiriTeleportMarker = [target, !!disabled];
    if (html !== undefined) tuple.push(html);
    return `<!--${markers.teleport}${encodeMarker(tuple)}-->`;
  };
  // Disabled content renders inline, so the walker reads it from the DOM.
  if (disabled) {
    parentPush(open());
    vueSsrRenderTeleport(parentPush, contentRenderFn, target, disabled, parentComponent);
    return;
  }

  // Filled once the content is rendered; flagged async in case the content is.
  const marker: SSRBuffer = [];
  marker.hasAsync = true;
  parentPush(marker);
  const content: SSRBuffer = [];
  vueSsrRenderTeleport(
    parentPush,
    (push) =>
      contentRenderFn((item) => {
        content.push(item);
        push(item);
      }),
    target,
    disabled,
    parentComponent,
  );
  marker.push(chain(unroll(content), (html): SSRBuffer => [open(html)]));
}

/**
 * Component form of `ssrRenderClientComponent` for Vue's vnode slot branch,
 * taken when a non-compiled child renders the slot that holds the component.
 */
export const OnigiriClientBoundary = /* @__PURE__ */ defineComponent({
  name: "OnigiriClientBoundary",
  props: ["is", "props", "when"],
  ssrRender(
    _ctx: unknown,
    push: PushFn,
    instance: ComponentInternalInstance,
    attrs: Record<string, unknown> | undefined,
  ) {
    const { is, props, when } = instance.props as unknown as ClientBoundaryProps;
    // Every real prop is declared, so Vue's attrs here are scope ids only: this vnode's own,
    // which belongs on the child's root, and slot scope ids, which Vue applies to the whole subtree.
    const rootScopeId = instance.vnode.scopeId;
    const slotScopeIds = attrs
      ? Object.keys(attrs)
          .filter((id) => id !== rootScopeId)
          .join(" ")
      : "";
    if (rootScopeId) pushScopeId(rootScopeId);
    try {
      push(
        ssrRenderClientComponent(
          is,
          props,
          instance.slots as SSRSlots,
          instance,
          when,
          slotScopeIds || undefined,
        ),
      );
    } finally {
      if (rootScopeId) popScopeId();
    }
  },
});

let lastNonce: string | undefined;
let lastMarkers: MarkerSet | undefined;

function markersOf(parent: ComponentInternalInstance): MarkerSet | undefined {
  // `provides` is internal but is where `renderToString` leaves the SSR context for every instance.
  const { provides } = parent as unknown as { provides: Record<symbol, any> };
  const context = provides[ssrContextKey];
  const nonce = context?.[ONIGIRI_NONCE_KEY] as string | undefined;
  if (!nonce) return;
  if (nonce !== lastNonce) {
    lastNonce = nonce;
    lastMarkers = createMarkerSet(nonce);
  }
  return lastMarkers!;
}

function insideClientComponent(owner: ComponentInternalInstance | null): boolean {
  for (let current = owner; current; current = current.parent) {
    if (CLIENT_VNODES.has(current.vnode)) return true;
  }
  return false;
}

function describeComponent(component: Component): { chunk: string; exportName: string } {
  const descriptor = (component as { __onigiriDescriptor?: OnigiriDescriptor }).__onigiriDescriptor;
  if (!descriptor?.chunk) {
    const name = (component as any).__name ?? (component as any).name ?? "anonymous component";
    throw new Error(
      `[vue-onigiri] Cannot mark <${name} v-load-client>: no __onigiriDescriptor attached. ` +
        "Compile the component through vue-onigiri's plugin so the descriptor is attached at build time.",
    );
  }
  return { chunk: descriptor.chunk, exportName: descriptor.export ?? "default" };
}

/**
 * Wrap each slot so its first render is recorded for the marker while still reaching the child.
 */
function captureSlots(
  slots: SSRSlots | null | undefined,
  captured: Record<string, SSRBuffer>,
  boundary: ComponentInternalInstance,
): SSRSlots | null {
  if (!slots) return null;
  const names = Object.keys(slots);
  if (names.length === 0) return null;
  const wrapped: SSRSlots = {};
  for (const name of names) {
    const slot = slots[name]!;
    // Rest args keep `length` at 0: dev `renderSlot` empties any slot declaring SSR-style params.
    wrapped[name] = (...args: Parameters<SSRSlot>) => {
      const [slotProps, push, parent = boundary, scopeId = null] = args;
      // Vnode-style callers (manual render functions) pass no push; the vnodes render twice then.
      if (!push) {
        const result = slot(slotProps, undefined, parent, scopeId);
        if (!(name in captured) && Array.isArray(result)) {
          captured[name] = renderVNodesToBuffer(result, parent, scopeId);
        }
        return result;
      }
      const buffer: SSRBuffer = [];
      const bufferedPush: PushFn = (item) => {
        buffer.push(item);
      };
      const result = slot(slotProps, bufferedPush, parent, scopeId);
      if (Array.isArray(result)) {
        for (const item of renderVNodesToBuffer(result, parent, scopeId)) buffer.push(item);
      }
      if (!(name in captured)) captured[name] = buffer;
      for (const item of buffer) push(item);
    };
  }
  // Compiled slot objects carry `_: 1` so Vue hands them to the child untouched.
  return Object.assign(wrapped, { _: 1 });
}

function renderVNodesToBuffer(
  children: unknown[],
  parent: ComponentInternalInstance,
  scopeId: string | null,
): SSRBuffer {
  // Read per call: a top-level read of `ssrUtils` would keep this module in client bundles.
  const { normalizeVNode }: { normalizeVNode: (child: unknown) => VNode } = ssrUtils;
  const buffer: SSRBuffer = [];
  const push: PushFn = (item) => {
    buffer.push(item);
  };
  for (const child of children) {
    ssrRenderVNode(push, normalizeVNode(child), parent, scopeId?.trim() || undefined);
  }
  return buffer;
}

function withoutListeners(
  props: Record<string, any> | null | undefined,
): Record<string, any> | null {
  if (!props) return null;
  const result: Record<string, any> = {};
  for (const key in props) {
    if (key.startsWith("on") && key[2] && key[2].toUpperCase() === key[2]) continue;
    result[key] = props[key];
  }
  return result;
}

/**
 * Join a render buffer, staying synchronous unless an item is a Promise.
 */
function unroll(buffer: SSRBuffer): MaybePromise<string> {
  let html = "";
  for (let i = 0; i < buffer.length; i++) {
    const item = buffer[i]!;
    if (typeof item === "string") {
      html += item;
      continue;
    }
    const rest = chain(item, unroll);
    if (typeof rest === "string") {
      html += rest;
      continue;
    }
    return chain(rest, (resolved) =>
      chain(unroll(buffer.slice(i + 1)), (tail) => html + resolved + tail),
    );
  }
  return html;
}

function unrollRecord(
  buffers: Record<string, SSRBuffer>,
): MaybePromise<Record<string, string> | undefined> {
  const names = Object.keys(buffers);
  if (names.length === 0) return undefined;
  const result: Record<string, string> = {};
  let pending: Promise<void>[] | undefined;
  for (const name of names) {
    const assigned = chain(unroll(buffers[name]!), (html) => {
      result[name] = html;
    });
    if (isPromise(assigned)) (pending ??= []).push(assigned);
  }
  return pending ? Promise.all(pending).then(() => result) : result;
}

/**
 * Apply `fn` to a value that may be a Promise, staying synchronous when it is not.
 */
function chain<T, R>(value: MaybePromise<T>, fn: (value: T) => MaybePromise<R>): MaybePromise<R> {
  return isPromise(value) ? value.then(fn) : fn(value);
}
