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

  const instance = createComponentInstance(vnode, input._instance, null);
  const res = await setupComponent(instance, true);
  const hasAsyncSetup = isPromise(res);
  let prefetches =
    // @ts-expect-error internal API
    instance.sp as unknown as Promise[]; /* LifecycleHooks.SERVER_PREFETCH */

  const child = renderComponentRoot(instance);

  if (hasAsyncSetup || prefetches) {
    const p: Promise<unknown> = Promise.resolve(res).then(() => {
      // instance.sp may be null until an async setup resolves, so evaluate it here
      // @ts-expect-error internal API
      if (hasAsyncSetup) prefetches = instance.sp;
      if (prefetches) {
        return Promise.all(
          prefetches.map((prefetch) => prefetch.call(instance.proxy)),
        );
      }
    });
    await p;
  }
  return renderVNode(child);
}

export async function serializeApp(app: App, context: SSRContext = {}) {
  const input = app;
  app.provide(ssrContextKey, context);

  const vnode = createVNode(input._component, input._props);
  // vnode.appContext = input._context
  const instance = createComponentInstance(vnode, input._instance, null);
  instance.appContext = input._context;

  return await app.runWithContext(async () => {
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
}

export async function renderVNode(
  vnode: VNodeChild,
  parentInstance?: ComponentInternalInstance,
): Promise<VServerComponent | undefined> {
  if (isVNode(vnode)) {
    if (vnode.shapeFlag & ShapeFlags.ELEMENT) {
      return {
        type: VServerComponentType.Element,
        tag: vnode.type as string,
        props: vnode.props ?? undefined,
        children: await renderChild(
          vnode.children ||
            vnode.component?.subTree ||
            vnode.component?.vnode.children,
          parentInstance,
        ),
      };
    } else if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
      const instance = createComponentInstance(
        vnode,
        parentInstance ?? null,
        null,
      );
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

      if (
        vnode.props &&
        "load:client" in vnode.props &&
        vnode.props["load:client"] !== false
      ) {
        // @ts-expect-error
        if (vnode.type.__chunk) {
          return {
            type: VServerComponentType.Component,
            props: vnode.props ?? undefined,
            // @ts-expect-error
            chunk: vnode.type.__chunk as string,
            slots: await renderSlots(child.ctx?.__slotsResult),
          };
        }
        console.warn("Component is missing chunk information");
        return {
          type: VServerComponentType.Fragment,
          children: await renderChild(
            vnode.children ||
              vnode.component?.subTree ||
              vnode.component?.vnode.children,
            parentInstance,
          ),
        };
      }
      return {
        type: VServerComponentType.Fragment,
        children: await renderChild(child, parentInstance),
      };
    }
    // handle suspense
    else if (vnode.shapeFlag & ShapeFlags.SUSPENSE) {
      return {
        type: VServerComponentType.Suspense,
        // @ts-expect-error internal API
        children: await renderChild(vnode.ssContent, parentInstance),
      };
    } else if (vnode.type === Text) {
      return {
        type: VServerComponentType.Text,
        text: vnode.children as string,
      };
    } else if (vnode.type === Fragment) {
      return {
        type: VServerComponentType.Fragment,
        children: await renderChild(vnode.children, parentInstance),
      };
    }
  } else if (
    vnode &&
    (typeof vnode === "string" || typeof vnode === "number")
  ) {
    return {
      type: VServerComponentType.Text,
      text: vnode as string,
    };
  }
}

async function renderChild(
  children?: VNodeNormalizedChildren | VNode,
  parentInstance?: ComponentInternalInstance,
): Promise<VServerComponent[] | VServerComponent | undefined> {
  if (!children) {
    return;
  }

  if (isVNode(children)) {
    return await renderVNode(children, parentInstance);
  }

  if (Array.isArray(children)) {
    return (
      await Promise.all(
        children.map((vnode) => renderVNode(vnode, parentInstance)),
      )
    ).filter((v): v is VServerComponent => !!v);
  }

  if (typeof children === "string" || typeof children === "number") {
    return {
      type: VServerComponentType.Text,
      text: children as string,
    };
  }
}

async function renderSlots(
  slots: Record<string, VNode> | undefined,
): Promise<Record<string, VServerComponent[] | VServerComponent>> {
  if (!slots) {
    return {};
  }
  const result: Record<string, VServerComponent[] | VServerComponent> = {};
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
        result[key] = r;
      }
    } else {
      console.warn(`Unexpected slot type: ${typeof slot} for key: ${key}`);
    }
  }
  return result;
}
