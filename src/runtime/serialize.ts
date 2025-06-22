import type { SSRContext } from "@vue/server-renderer";
import {
  createVNode,
  isVNode,
  type App,
  type VNode,
  type VNodeChild,
  type VNodeNormalizedChildren,
  // @ts-expect-error ssrUtils is not a public API
  ssrUtils,
  type ComponentInternalInstance,
  type SuspenseBoundary,
  createApp,
  Text,
  ssrContextKey,
  Fragment,
  type Component,
} from "vue";
import { isPromise, ShapeFlags } from "@vue/shared";
import { VServerComponentType, type VServerComponent } from "./shared";

const {
  createComponentInstance,
  setupComponent,
  renderComponentRoot,
}: {
  createComponentInstance: (
    vnode: VNode,
    parent: ComponentInternalInstance | null,
    suspense: SuspenseBoundary | null,
  ) => ComponentInternalInstance;
  setupComponent: (
    instance: ComponentInternalInstance,
    isSSR?: boolean,
  ) => Promise<void> | undefined;
  renderComponentRoot: (
    instance: ComponentInternalInstance,
  ) => VNode & { ctx?: { __slotsResult?: Record<string, VNode> } };
} = ssrUtils;

export async function serializeComponent(component: Component, props?: any) {
  const input = createApp(component, props);
  const vnode = createVNode(input._component, input._props);
  vnode.appContext = input._context;

  const child = await renderComponent(vnode, input._instance);
  return renderVNode(child);
}

export async function serializeApp(app: App, context: SSRContext = {}) {
  const input = app;
  app.provide(ssrContextKey, context);

  const vnode = createVNode(input._component, input._props);
  // vnode.appContext = input._context
  const instance = createComponentInstance(vnode, input._instance, null);
  instance.appContext = input._context;

  const r = await app.runWithContext(async () => {
    const res = await setupComponent(instance, true);
    return await app.runWithContext(async () => {
      const hasAsyncSetup = isPromise(res);

      let prefetches =
        // @ts-expect-error internal API
        instance.sp as unknown as Promise[]; /* LifecycleHooks.SERVER_PREFETCH */

      const child = renderComponentRoot(instance);

      if (hasAsyncSetup || prefetches) {
        const p: Promise<unknown> = Promise.resolve(res).then(() => {
          // instance.sp may be null until an async setup resolves, so evaluate it here
          if (hasAsyncSetup) {
            // @ts-expect-error internal API
            prefetches = instance.sp;
          }
          if (prefetches) {
            return Promise.all(
              prefetches.map((prefetch) => prefetch.call(instance.proxy)),
            );
          }
        });

        await p;
      }
      return await renderVNode(child, instance);
    });
  });
  return r;
}

export async function renderVNode(
  vnode: VNodeChild,
  parentInstance?: ComponentInternalInstance,
): Promise<VServerComponent | undefined> {
  if (isVNode(vnode)) {
    if (vnode.shapeFlag & ShapeFlags.ELEMENT) {
      return [
        VServerComponentType.Element,
        vnode.type as string,
        vnode.props ?? undefined,
        await renderChild(vnode.children, parentInstance),
      ];
    } else if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
      const child = await renderComponent(vnode, parentInstance);
      if (
        vnode.props &&
        "load:client" in vnode.props &&
        vnode.props["load:client"] !== false
      ) {
        // @ts-expect-error
        if (vnode.type.__chunk) {
          return [
            VServerComponentType.Component,
            vnode.props ?? undefined,
            // @ts-expect-error
            vnode.type.__chunk as string,
            await renderSlots(child.ctx?.__slotsResult),
          ];
        }
        console.warn("Component is missing chunk information");
      }

      return [
        VServerComponentType.Fragment,
        await renderChild(child.children, parentInstance),
      ];
    }
    // handle suspense
    else if (vnode.shapeFlag & ShapeFlags.SUSPENSE) {
      return [
        VServerComponentType.Suspense,
        // @ts-expect-error internal API
        await renderChild(vnode.ssContent, parentInstance),
      ];
    } else if (vnode.type === Text) {
      return [VServerComponentType.Text, vnode.children as string];
    } else if (vnode.type === Fragment) {
      return [
        VServerComponentType.Fragment,
        await renderChild(vnode.children, parentInstance),
      ];
    }
  } else if (
    vnode &&
    (typeof vnode === "string" || typeof vnode === "number")
  ) {
    return [VServerComponentType.Text, vnode as string];
  }
}

async function renderChild(
  children?: VNodeNormalizedChildren | VNode,
  parentInstance?: ComponentInternalInstance,
): Promise<VServerComponent[] | undefined> {
  if (!children) {
    return;
  }

  if (isVNode(children)) {
    return await renderChild([children], parentInstance);
  }

  if (Array.isArray(children)) {
    return (
      await Promise.all(
        children.map((vnode) => renderVNode(vnode, parentInstance)),
      )
    ).filter((v): v is VServerComponent => !!v);
  }
  if (typeof children === "string" || typeof children === "number") {
    return [[VServerComponentType.Text, children as string]];
  }
}

async function renderSlots(
  slots: Record<string, VNode> | undefined,
): Promise<Record<string, VServerComponent[]>> {
  if (!slots) {
    return {};
  }
  const result: Record<string, VServerComponent[]> = {};
  for (const key in slots) {
    const slot = slots[key];
    if (Array.isArray(slot)) {
      const r = (
        await Promise.all(slot.map((vnode) => renderVNode(vnode)))
      ).filter(Boolean) as VServerComponent[];
      if (r.length > 0) {
        result[key] = r;
      }
    } else if (isVNode(slot)) {
      const r = await renderVNode(slot);
      if (r) {
        result[key] = [r];
      }
    } else {
      console.warn(`Unexpected slot type: ${typeof slot} for key: ${key}`);
    }
  }
  return result;
}

async function renderComponent(
  vnode: VNode,
  parentInstance?: ComponentInternalInstance | null,
) {
  const instance = createComponentInstance(vnode, parentInstance ?? null, null);
  const res = await setupComponent(instance, true);
  const hasAsyncSetup = isPromise(res);
  let prefetches =
    // @ts-expect-error internal API
    instance.sp as unknown as Promise[]; /* LifecycleHooks.SERVER_PREFETCH */

  const child = renderComponentRoot(instance);

  if (hasAsyncSetup || prefetches) {
    const p: Promise<unknown> = Promise.resolve(res).then(() => {
      // instance.sp may be null until an async setup resolves, so evaluate it here
      if (hasAsyncSetup) {
        // @ts-expect-error internal API
        prefetches = instance.sp;
      }
      if (prefetches) {
        return Promise.all(
          prefetches.map((prefetch) => prefetch.call(instance.proxy)),
        );
      }
    });
    await p;
  }

  return child;
}
