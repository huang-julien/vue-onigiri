import {
  isVNode,
  type ComponentInternalInstance,
  type VNodeChild,
  // @ts-expect-error ssrUtils is not a public API
  ssrUtils,
} from "vue";
import { serializeVNode, unrollServerComponentBufferPromises } from "./serialize";
import { VServerComponentType } from "./shared";
import type { VServerComponent, VServerComponentBuffered } from "./shared";

const {
  setCurrentRenderingInstance,
}: {
  setCurrentRenderingInstance: (
    instance: ComponentInternalInstance | null,
  ) => ComponentInternalInstance | null;
} = ssrUtils;

function wrapSlotResult(result: any): any {
  if (!Array.isArray(result)) return result;
  const filtered = result.filter((v) => v !== undefined && v !== null && v !== false);
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];
  return [VServerComponentType.Fragment, filtered];
}

/**
 * Render a slot for onigiri serialization.
 *
 * Slots always resolve at the producer boundary (serialize time).
 * No slot markers are emitted: if the slot is missing, the fallback
 * (or undefined) is inlined directly.
 *
 * Handles three cases:
 * 1. Slot is a function that returns VNodes - call and serialize
 * 2. Slot is a function that returns pre-serialized content - call and return
 * 3. Slot is pre-serialized content (array) - return as-is
 *
 */
export function renderSlot(
  ctx: any,
  slots: Record<string, ((props?: any) => any) | any> | undefined,
  name: string,
  props?: Record<string, any>,
  fallback?: () => VServerComponentBuffered | VServerComponentBuffered[],
):
  | VServerComponentBuffered
  | VServerComponentBuffered[]
  | Promise<VServerComponent | VServerComponent[]>
  | undefined {
  const parentInstance = ctx && ctx._ ? ctx._ : undefined;
  const slot = slots?.[name];

  const renderFallback = () => fallback && callInInstance(parentInstance, fallback);

  if (slot === undefined) {
    return wrapSlotResult(renderFallback());
  }

  if (typeof slot === "function") {
    const content = callInInstance(parentInstance, () => slot(props));

    if (content == null) {
      return wrapSlotResult(renderFallback());
    }

    if (Array.isArray(content)) {
      // Pre-serialized content either:
      // - VServerComponentBuffered tuples
      // - arrays of such tuples
      // - Promises returned by nested __serializeComponentInContext calls
      // unrollServerComponentBufferPromises will flatten everything later.
      const first = content[0];
      const isBuffered =
        typeof first === "number" ||
        (Array.isArray(first) && typeof first[0] === "number") ||
        first instanceof Promise;
      if (isBuffered) {
        return wrapSlotResult(content);
      }
      if (isVNode(first)) {
        return Promise.all(
          content.map(async (child: VNodeChild) => {
            const serialized = await serializeVNode(child, parentInstance);
            if (serialized) {
              return unrollServerComponentBufferPromises(serialized);
            }
            return undefined;
          }),
        ).then((results) => wrapSlotResult(results.filter(Boolean)) as VServerComponent);
      }
      return wrapSlotResult(content) as VServerComponentBuffered;
    }

    return serializeVNode(content as VNodeChild, parentInstance).then((serialized) => {
      if (serialized) {
        return unrollServerComponentBufferPromises(serialized);
      }
      return unrollServerComponentBufferPromises(renderFallback() as VServerComponentBuffered);
    });
  }

  return slot as VServerComponentBuffered;
}

function callInInstance<T>(instance: ComponentInternalInstance | undefined, fn: () => T): T {
  if (!instance) return fn();
  const prev = setCurrentRenderingInstance(instance);
  try {
    return fn();
  } finally {
    setCurrentRenderingInstance(prev);
  }
}
