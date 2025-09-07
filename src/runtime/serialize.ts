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
  mergeProps,
  type DirectiveBinding,
  type VNodeProps,
} from "vue";
import { isPromise, ShapeFlags } from "@vue/shared";
import {
  type VServerComponentBuffered,
  VServerComponentType,
  type VServerComponent,
} from "./shared";
import type { MaybePromise } from "rollup";

declare module "vue" {
  interface ComponentInternalInstance {
    __slotsResult?: Record<string, VNode>;
  }
}

// todo better way to detect SSR
declare global {
  interface ImportMeta {
    server: boolean;
  }
}

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
  renderComponentRoot: (instance: ComponentInternalInstance) => VNode & {
    __slotsResult?: Record<string, VNode>;
    _onigiriLoadClient?: boolean;
  };
} = ssrUtils;

export async function serializeComponent(
  component: Component,
  props?: any,
  context: SSRContext = {},
) {
  const input = createApp(component, props);
  return serializeApp(input, context);
}

export function serializeApp(app: App, context: SSRContext = {}) {
  const input = app;
  app.provide(ssrContextKey, context);
  applyDirective(app);
  const vnode = createVNode(input._component, input._props);
  // vnode.appContext = input._context
  const instance = createComponentInstance(vnode, input._instance, null);
  instance.appContext = input._context;

  instance.provides = /* @__PURE__ */ Object.create(input._context.provides);
  return app.runWithContext(async () => {
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

        return p.then(() =>
          serializeVNode(child, instance).then((result) => {
            if (result) {
              return unrollServerComponentBufferPromises(result);
            }
          }),
        );
      }
      return serializeVNode(child, instance).then((result) => {
        if (result) {
          return unrollServerComponentBufferPromises(result);
        }
      });
    });
  });
}

export function unrollServerComponentBufferPromises(
  buffer: VServerComponentBuffered | MaybePromise<VServerComponentBuffered>,
): Promise<VServerComponent> {
  if (isPromise(buffer)) {
    return buffer.then((r) => {
      return unrollServerComponentBufferPromises(r);
    });
  }
  const result = [] as unknown as VServerComponent;
  const promises: Promise<any>[] = [];

  for (const i in buffer) {
    const item = buffer[i];
    if (isPromise(item)) {
      promises.push(
        item.then((r) => {
          if (Array.isArray(r)) {
            return Promise.all(
              r.map((v) => unrollServerComponentBufferPromises(v)),
            ).then((unrolled) => {
              result[i] = unrolled;
            });
          }

          result[i] = r;
          return r;
        }),
      );
    } else {
      result[i] = item as VServerComponent;
    }
  }

  return Promise.all(promises).then(() => result);
}

export async function serializeVNode(
  vnode: VNodeChild,
  parentInstance?: ComponentInternalInstance,
): Promise<VServerComponentBuffered | undefined> {
  if (isVNode(vnode)) {
    if (vnode.shapeFlag & ShapeFlags.ELEMENT) {
      return [
        VServerComponentType.Element,
        vnode.type as string,
        filterProps(vnode.props),
        serializeChildren(vnode.children, parentInstance),
      ];
    } else if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
      return Promise.resolve(renderComponent(vnode, parentInstance)).then(
        (child) => {
            // @ts-expect-error
          if (child._onigiriLoadClient) {
            // @ts-expect-error
            if (vnode.type.__chunk && vnode.type.__export) {
              return [
                VServerComponentType.Component,
                filterProps(vnode.props),
                // @ts-expect-error
                vnode.type.__chunk as string,
                // @ts-expect-error
                vnode.type.__export as string,
                serializeSlots((child as any).__slotsResult),
              ];
            }
            console.warn("Component is missing chunk information");
          }

          return [
            VServerComponentType.Fragment,
            serializeChildren(child, parentInstance),
          ];
        },
      );
    }
    // handle suspense
    else if (vnode.shapeFlag & ShapeFlags.SUSPENSE) {
      return [
        VServerComponentType.Suspense,
        // @ts-expect-error internal API
        serializeChildren(vnode.ssContent, parentInstance),
      ];
    } else if (vnode.type === Text) {
      return [VServerComponentType.Text, vnode.children as string];
    } else if (vnode.type === Fragment) {
      return [
        VServerComponentType.Fragment,
        serializeChildren(vnode.children, parentInstance),
      ];
    }
  } else if (
    vnode &&
    (typeof vnode === "string" || typeof vnode === "number")
  ) {
    return [VServerComponentType.Text, vnode as string];
  }
}

function serializeChildren(
  children?: VNodeNormalizedChildren | VNode,
  parentInstance?: ComponentInternalInstance,
):
  | Promise<VServerComponentBuffered[]>
  | VServerComponentBuffered[]
  | undefined {
  if (!children) {
    return;
  }

  if (isVNode(children)) {
    return serializeChildren([children], parentInstance);
  }

  if (Array.isArray(children)) {
    return Promise.all(
      children.map((vnode) => serializeVNode(vnode, parentInstance)),
    ).then((vnodes) => vnodes.filter(Boolean) as VServerComponentBuffered[]);
  }
  if (typeof children === "string" || typeof children === "number") {
    return [[VServerComponentType.Text, children as string]];
  }
}

function serializeSlots(
  slots: Record<string, VNode[]> | undefined,
): MaybePromise<Record<string, VServerComponent[] | undefined>> | undefined {
  if (!slots) {
    return {};
  }
  const result: Record<string, VServerComponent[] | undefined> | undefined = {};
  const promises: Promise<any>[] = [];
  for (const key in slots) {
    const slot = slots[key];

    if (Array.isArray(slot)) {
      promises.push(
        Promise.all(
          slot.map(
            (vnode) =>
              Promise.resolve(serializeVNode(vnode)).then((v) => {
                if (v) {
                  return unrollServerComponentBufferPromises(v);
                }
              }) as Promise<VServerComponentBuffered | undefined>,
          ),
        ).then((vnodes) => {
          result[key] =
            vnodes.length > 0
              ? (vnodes.filter(Boolean) as VServerComponent[])
              : undefined;
        }),
      );
    } else if (isVNode(slot)) {
      promises.push(
        Promise.resolve(serializeVNode(slot))
          .then((v) => {
            if (v) {
              return unrollServerComponentBufferPromises(v);
            }
          })
          .then((vnode) => {
            result[key] = vnode ? [vnode] : undefined;
          }),
      );
    } else {
      console.warn(`Unexpected slot type: ${typeof slot} for key: ${key}`);
    }
  }
  return Promise.all(promises).then(() => {
    return result;
  });
}

function renderComponent(
  _vnode: VNode,
  parentInstance?: ComponentInternalInstance | null,
): Promise<VNodeNormalizedChildren> | VNodeNormalizedChildren | VNode {
  if(_vnode && _vnode.component && _vnode.component.subTree) {
    return _vnode.component.subTree
  }
  const instance = createComponentInstance(
    _vnode,
    parentInstance ?? null,
    null,
  );
  const res = setupComponent(instance, true);
  const hasAsyncSetup = isPromise(res);
  let prefetches =
    // @ts-expect-error internal API
    instance.sp as unknown as Promise[]; /* LifecycleHooks.SERVER_PREFETCH */

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
    return p.then(() => {
      const vnode = renderComponentRoot(instance);

      const { dirs, props } = vnode;
      if (dirs) {
        vnode.props = applySSRDirectives(vnode, props, dirs);
      }
      vnode.__slotsResult = instance.__slotsResult;
      if (child.shapeFlag & ShapeFlags.COMPONENT) {
        return renderComponent(child, parentInstance);
      }
      return vnode.children;
    });
  }
  const child = renderComponentRoot(instance);

  const { dirs, props } = child;
  if (dirs) {
    child.props = applySSRDirectives(child, props, dirs);
  }
  child.__slotsResult = instance.__slotsResult;
  if (child.shapeFlag & ShapeFlags.COMPONENT) {
    return renderComponent(child, instance);
  }
  return child.children;
}

// todo test this
function applySSRDirectives(
  vnode: VNode,
  rawProps: VNodeProps | null,
  dirs: DirectiveBinding[],
): VNodeProps {
  const toMerge: VNodeProps[] = [];
  // eslint-disable-next-line unicorn/no-for-loop
  for (let i = 0; i < dirs.length; i++) {
    const binding = dirs[i];
    const getSSRProps = binding?.dir.getSSRProps;
    if (getSSRProps) {
      const props = getSSRProps(binding, vnode);
      if (props) toMerge.push(props);
    }
  }
  return mergeProps(rawProps || {}, ...toMerge);
}

function applyDirective(app: App) {
  app.directive("load-client", {
    getSSRProps(binding, vnode) {
      if (binding.value !== false) {
        // @ts-ignore
        vnode._onigiriLoadClient = true;
      }
      return {};
    },
    created(_, binding, vnode) {
      if (binding.value !== false) {
        // @ts-ignore
        vnode._onigiriLoadClient = true;
      }
      return binding;
    },
  });
}

function filterProps(props: VNodeProps | undefined | null) {
  if (!props) return undefined;

  return Object.fromEntries(
    Object.entries(props).filter(
      ([key, _]) =>
        !(key.startsWith("on") && key[2] && key[2].toUpperCase() === key[2]),
    ),
  );
}
