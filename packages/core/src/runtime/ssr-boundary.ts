import {
  createVNode,
  defineComponent,
  ssrContextKey,
  type Component,
  type ComponentInternalInstance,
  type VNode,
  // @ts-expect-error ssrUtils is not a public API
  ssrUtils,
} from "vue";
import { ssrRenderComponent, ssrRenderVNode } from "vue/server-renderer";
import { isPromise } from "@vue/shared";
import {
  createMarkerNonce,
  createMarkerSet,
  encodeMarker,
  VServerComponentType,
  type MarkerSet,
  type MaybePromise,
  type VServerComponentComponent,
} from "@vue-onigiri/shared";

/** Props the SSR transform hands the boundary in place of the `v-load-client` component. */
export interface ClientBoundaryProps {
  /** Component the island renders on the server and the client reloads. */
  is: Component | string;
  /** Props of that component; listeners are dropped from the marker. */
  props?: Record<string, any> | null;
  /** The `v-load-client` binding; `false` renders the component inline without markers. */
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

/** Key under which the SSR context carries the marker nonce of the current render. */
export const ONIGIRI_NONCE_KEY = "onigiriNonce";

const { normalizeVNode }: { normalizeVNode: (child: unknown) => VNode } = ssrUtils;

let lastNonce: string | undefined;
let lastMarkers: MarkerSet | undefined;

/** Give an SSR context the nonce the markers bind to, returning that nonce. */
export function provideMarkerNonce<T extends Record<string, any>>(
  context: T,
): T & { [ONIGIRI_NONCE_KEY]: string } {
  (context as Record<string, any>)[ONIGIRI_NONCE_KEY] ??= createMarkerNonce();
  return context as T & { [ONIGIRI_NONCE_KEY]: string };
}

/**
 * Render a `v-load-client` component with Vue's SSR renderer and wrap its
 * output in island markers. The SSR transform emits this in place of
 * `ssrRenderComponent`; the returned buffer is pushed like any component.
 */
export function ssrRenderClientComponent(
  is: Component | string,
  props: Record<string, any> | null | undefined,
  slots: SSRSlots | null | undefined,
  parent: ComponentInternalInstance,
  when?: unknown,
): SSRBuffer | Promise<SSRBuffer> {
  if (when === false || typeof is === "string") {
    const buffer: SSRBuffer = [];
    ssrRenderVNode((item) => buffer.push(item), createVNode(is as Component, props, slots), parent);
    return buffer;
  }

  const markers = markersOf(parent);
  const { chunk, exportName } = describeComponent(is);
  const captured: Record<string, SSRBuffer> = {};
  const rendered = unroll(
    ssrRenderComponent(
      is,
      props,
      captureSlots(slots, captured, parent) as Parameters<typeof ssrRenderComponent>[2],
      parent,
    ) as SSRBuffer,
  );
  const finish = (html: string): MaybePromise<SSRBuffer> => {
    const slotHtml = unrollRecord(captured);
    const marker = (resolvedSlots: Record<string, string> | undefined): SSRBuffer => {
      const tuple: VServerComponentComponent = [
        VServerComponentType.Component,
        withoutListeners(props),
        chunk,
        exportName,
      ];
      if (resolvedSlots) tuple.push(resolvedSlots);
      return [
        `<!--${markers.component}${encodeMarker(tuple)}-->`,
        html,
        `<!--${markers.componentEnd}-->`,
      ];
    };
    return isPromise(slotHtml) ? slotHtml.then(marker) : marker(slotHtml);
  };
  return isPromise(rendered) ? rendered.then(finish) : finish(rendered);
}

/**
 * Component form of `ssrRenderClientComponent` for Vue's vnode slot branch,
 * taken when a non-compiled child renders the slot that holds the component.
 */
export const OnigiriClientBoundary = defineComponent({
  name: "OnigiriClientBoundary",
  props: ["is", "props", "when"],
  ssrRender(_ctx: unknown, push: PushFn, instance: ComponentInternalInstance) {
    const { is, props, when } = instance.props as unknown as ClientBoundaryProps;
    push(ssrRenderClientComponent(is, props, instance.slots as SSRSlots, instance, when));
  },
});

function markersOf(parent: ComponentInternalInstance): MarkerSet {
  // `provides` is internal but is where `renderToString` leaves the SSR context for every instance.
  const { provides } = parent as unknown as { provides: Record<symbol, any> };
  const context = provides[ssrContextKey];
  const nonce = context?.[ONIGIRI_NONCE_KEY] as string | undefined;
  if (!nonce) {
    throw new Error(
      "[vue-onigiri] v-load-client under Vue SSR needs a marker nonce: " +
        "call provideMarkerNonce(context) before renderToString(app, context).",
    );
  }
  if (nonce !== lastNonce) {
    lastNonce = nonce;
    lastMarkers = createMarkerSet(nonce);
  }
  return lastMarkers!;
}

function describeComponent(component: Component): { chunk: string; exportName: string } {
  const descriptor = (component as { __onigiriASTDescriptor?: { chunk: string; export?: string } })
    .__onigiriASTDescriptor;
  if (!descriptor?.chunk) {
    const name = (component as any).__name ?? (component as any).name ?? "anonymous component";
    throw new Error(
      `[vue-onigiri] Cannot mark <${name} v-load-client>: no __onigiriASTDescriptor attached. ` +
        "Compile the component through vue-onigiri's plugin so the descriptor is attached at build time.",
    );
  }
  return { chunk: descriptor.chunk, exportName: descriptor.export ?? "default" };
}

/** Wrap each slot so its first render is recorded for the marker while still reaching the child. */
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
): Record<string, any> | undefined {
  if (!props) return undefined;
  const result: Record<string, any> = {};
  for (const key in props) {
    if (key.startsWith("on") && key[2] && key[2].toUpperCase() === key[2]) continue;
    result[key] = props[key];
  }
  return result;
}

/** Join a render buffer, staying synchronous unless an item is a Promise. */
function unroll(buffer: SSRBuffer): MaybePromise<string> {
  let html = "";
  for (let i = 0; i < buffer.length; i++) {
    const item = buffer[i]!;
    if (typeof item === "string") {
      html += item;
      continue;
    }
    const rest = isPromise(item) ? item.then(unroll) : unroll(item);
    if (typeof rest === "string") {
      html += rest;
      continue;
    }
    return rest.then((resolved) => {
      const tail = unroll(buffer.slice(i + 1));
      return isPromise(tail) ? tail.then((t) => html + resolved + t) : html + resolved + tail;
    });
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
    const html = unroll(buffers[name]!);
    if (typeof html === "string") result[name] = html;
    else {
      (pending ??= []).push(
        html.then((resolved) => {
          result[name] = resolved;
        }),
      );
    }
  }
  return pending ? Promise.all(pending).then(() => result) : result;
}
