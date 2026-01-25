import type { VNodeChild } from "vue";
import { serializeVNode, unrollServerComponentBufferPromises } from "./serialize";
import { VServerComponentType, type VServerComponent, type VServerComponentBuffered } from "./shared";

/**
 * Render a slot for onigiri serialization.
 * 
 * Handles two cases:
 * 1. Slot functions that return VNodes (from runtime) - need to serialize
 * 2. Slot functions that return pre-serialized content (from compile-time) - just call and return
 * 
 * @param ctx - Component instance proxy (not used but kept for signature compatibility)
 * @param slots - Object containing slot functions or pre-serialized content
 * @param name - Slot name (e.g., "default", "header")
 * @param props - Props to pass to scoped slots
 * @param fallback - Fallback content generator if slot is not provided
 * @returns Serialized slot content or promise of it
 */
export function renderSlot(
  ctx: any,
  slots: Record<string, ((props?: any) => any) | any> | undefined,
  name: string,
  props?: Record<string, any>,
  fallback?: () => VServerComponentBuffered | VServerComponentBuffered[],
): VServerComponentBuffered | VServerComponentBuffered[] | Promise<VServerComponent | VServerComponent[]> | undefined {
  const slot = slots?.[name];
  
  if (slot === undefined) {
    // No slot provided - return a slot marker so client can fill it
    // Fallback content is baked into the marker
    const fallbackContent = fallback?.();
    const fallbackArray = fallbackContent 
      ? (Array.isArray(fallbackContent) && typeof fallbackContent[0] !== 'number' 
          ? fallbackContent 
          : [fallbackContent]) as VServerComponentBuffered[]
      : undefined;
    return createSlotMarker(name, props, fallbackArray);
  }
  
  if (typeof slot === 'function') {
    // Call the slot function with props
    const content = slot(props);
    
    if (content == null) {
      return fallback?.();
    }
    
    // Check if content is already serialized (array starting with a number = VServerComponentType)
    if (Array.isArray(content)) {
      const first = content[0];
      // If first element is a number, it's likely already serialized [Type, ...]
      // Or if it's an array with a number first element, it's an array of serialized vnodes
      if (typeof first === 'number') {
        // Single serialized vnode like [3, "div", ...]
        return content as VServerComponentBuffered;
      }
      if (Array.isArray(first) && typeof first[0] === 'number') {
        // Array of serialized vnodes like [[3, "div", ...], [2, "text"]]
        return content as VServerComponentBuffered[];
      }
      
      // Otherwise it's VNode content that needs serialization
      return Promise.all(
        content.map(async (child: VNodeChild) => {
          const serialized = await serializeVNode(child);
          if (serialized) {
            return unrollServerComponentBufferPromises(serialized);
          }
          return undefined;
        })
      ).then((results) => results.filter(Boolean) as VServerComponent[]);
    }
    
    // Single VNode - serialize it
    return serializeVNode(content as VNodeChild).then((serialized) => {
      if (serialized) {
        return unrollServerComponentBufferPromises(serialized);
      }
      return fallback?.();
    }) as Promise<VServerComponent>;
  }
  
  // Slot is already serialized content (not a function)
  return slot as VServerComponentBuffered;
}

export function createSlotMarker(
  name: string,
  props?: Record<string, any>,
  fallback?: VServerComponentBuffered[],
): VServerComponentBuffered {
  return [
    VServerComponentType.Slot,
    name,
    props,
    fallback,
  ];
}
