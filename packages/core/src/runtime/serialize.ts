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
  ONIGIRI_RENDER_SYMBOL,
} from "./shared";
import type { MaybePromise } from "rollup";

declare module "vue" {
  interface ComponentInternalInstance {
    __slotsResult?: Record<string, VNode>;
  }
}

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
  slots?: Record<string, ((scope?: any) => any) | VServerComponent[]>,
  context: SSRContext = {},
) {
  const input = createApp(component, props);
  return serializeApp(input, slots, context);
}

/** @deprecated Use `serializeComponent`. */
export const renderToSerializedVNode = serializeComponent;

export interface OnigiriASTDescriptor {
  chunk: string;
  export?: string;
}

type OnigiriComponent = Component & {
  __onigiriRender?: (...args: any[]) => VServerComponentBuffered;
  __onigiriASTDescriptor?: OnigiriASTDescriptor;
};

export async function serializeChildComponent(
  component: OnigiriComponent,
  props?: any,
  parentInstance?: ComponentInternalInstance,
  loadClient?: boolean,
  slots?: Record<string, VServerComponent[] | ((props?: any) => any)>,
  fallbackChunk?: string,
  fallbackExport: string = "default",
): Promise<VServerComponent | undefined> {
  if (loadClient) {
    const descriptor = component.__onigiriASTDescriptor;
    const chunk = descriptor?.chunk ?? fallbackChunk;
    const exportName = descriptor?.export ?? fallbackExport;
    if (!chunk) {
      const name = (component as any).__name ?? (component as any).name ?? "anonymous component";
      throw new Error(
        `[vue-onigiri] Cannot serialize <${name} v-load-client>: no __onigiriASTDescriptor ` +
          `attached to the component and no fallback descriptor emitted at the call site. ` +
          `Either compile the component through vue-onigiri's plugin (so the descriptor is ` +
          `attached at build time), or pass it through additionalImports so the compiler can ` +
          `bake a call-site fallback.`,
      );
    }
    return [
      VServerComponentType.Component,
      filterProps(props),
      chunk,
      exportName,
      slots as Record<string, VServerComponent[]> | undefined,
    ];
  }
  return serializeComponentInContext(component, props, parentInstance, slots);
}

/**
 * Serialize a component within an existing render context. Called by
 * the compiled `__onigiriRender` function for each child component.
 */
export function serializeComponentInContext(
  component: OnigiriComponent,
  props?: any,
  parentInstance?: ComponentInternalInstance,
  slots?: Record<string, ((props?: any) => any) | VServerComponent[]>,
): Promise<VServerComponent | undefined> {
  const vnode = createVNode(component, props, slots as any);
  const instance = createComponentInstance(vnode, parentInstance ?? null, null);
  inheritAppContext(instance, parentInstance);
  const res = setupComponent(instance, true);

  const hasAsyncSetup = isPromise(res);
  let prefetches =
    // @ts-expect-error internal API
    instance.sp as unknown as Promise[] | undefined;

  const doRender = (): Promise<VServerComponent | undefined> => {
    const taggedRender = pickTaggedRender(instance);
    if (taggedRender) {
      const rendered = taggedRender.call(instance.proxy, instance.proxy, instance);
      if (isPromise(rendered)) {
        return rendered.then((r: VServerComponentBuffered) =>
          unrollServerComponentBufferPromises(r),
        );
      }
      return unrollServerComponentBufferPromises(rendered as VServerComponentBuffered);
    }

    if (typeof component.__onigiriRender === "function") {
      const result = runOnigiriRender(component.__onigiriRender, instance);
      return unrollServerComponentBufferPromises(result);
    }

    const child = renderComponentRoot(instance);
    return Promise.resolve(serializeVNode(child, instance)).then((result) => {
      if (result) {
        return unrollServerComponentBufferPromises(result);
      }
    });
  };

  if (hasAsyncSetup || prefetches) {
    return Promise.resolve(res).then(() => {
      if (hasAsyncSetup) {
        // @ts-expect-error internal API
        prefetches = instance.sp;
      }
      if (prefetches) {
        return Promise.all(prefetches.map((prefetch) => prefetch.call(instance.proxy))).then(
          doRender,
        );
      }
      return doRender();
    });
  }

  return doRender();
}

function inheritAppContext(
  instance: ComponentInternalInstance,
  parentInstance?: ComponentInternalInstance,
): void {
  // @ts-expect-error internal API
  if (instance.appContext && instance.provides) return;
  let p: ComponentInternalInstance | null | undefined = parentInstance;
  while (p) {
    if (!instance.appContext && p.appContext) {
      instance.appContext = p.appContext;
    }
    // @ts-expect-error internal API

    if (!instance.provides && p.provides) {
      // @ts-expect-error internal API
      instance.provides = p.provides;
    } // @ts-expect-error internal API

    if (instance.appContext && instance.provides) break;
    p = p.parent;
  }
}

/**
 * Prefer the inject-setup tagged render (closure-bound) over the
 * standalone `__onigiriRender` property. The standalone reads bindings
 * via `_ctx.foo`, which is empty when plugin-vue inlines the SSR render
 * (`__ssrInlineRender: true`). For inline-render components Vue assigns
 * the setup-returned function to `instance.ssrRender`; for split-module
 * components it goes to `instance.render`.
 */
function pickTaggedRender(
  instance: ComponentInternalInstance,
): ((...args: any[]) => any) | undefined {
  const render = (instance as any).render;
  // @ts-expect-error internal SSR-mode field
  const ssrRender = instance.ssrRender;
  return (render?.__onigiri && render) || (ssrRender?.__onigiri && ssrRender) || undefined;
}

/**
 * build a ctx.proxy to run the tagged render function with, which provides access to props, data, setup state, and public instance properties. This is necessary for the tagged render to be able to read bindings when plugin-vue inlines the SSR render.
 *
 * simulates the behavior of vue in dev mode
 */
function createOnigiriCtx(instance: ComponentInternalInstance): any {
  return new Proxy(
    { _: instance },
    {
      get(_target, key) {
        if (key === "_") return instance;
        // @ts-expect-error internal API
        if (key === "$setup") return instance.setupState;
        if (key === "$props") return instance.props;
        if (key === "$data") return instance.data;
        if (key === "$options") return instance.type;
        if (key === "$slots") return instance.slots;
        if (key === "$emit") return instance.emit;
        if (key === "$refs") return instance.refs;
        if (key === "$attrs") return instance.attrs;
        if (key === "$parent") return instance.parent;
        if (key === "$root") return instance.root;
        if (key === "props") return instance.props;
        // @ts-expect-error internal API
        const setupState = instance.setupState;
        if (setupState && typeof key === "string" && key in setupState) return setupState[key];
        const data = instance.data as any;
        if (data && typeof key === "string" && key in data) return data[key];
        const props = instance.props as any;
        if (props && typeof key === "string" && key in props) return props[key];
        return (instance.proxy as any)?.[key];
      },
      has(_target, key) {
        if (typeof key !== "string") return false;
        if (key === "props") return true;
        // @ts-expect-error internal API
        const setupState = instance.setupState;
        if (setupState && key in setupState) return true;
        const data = instance.data as any;
        if (data && key in data) return true;
        const props = instance.props as any;
        if (props && key in props) return true;
        return key in (instance.proxy ?? {});
      },
    },
  );
}

function runOnigiriRender(
  onigiriRender: (...args: any[]) => VServerComponentBuffered,
  instance: ComponentInternalInstance,
): VServerComponentBuffered {
  return onigiriRender(createOnigiriCtx(instance), instance);
}

export function serializeApp(
  app: App,
  slots?: Record<string, ((scope?: any) => any) | VServerComponent[]>,
  context: SSRContext = {},
) {
  const input = app;
  app.provide(ssrContextKey, context);
  app.provide(ONIGIRI_RENDER_SYMBOL, true as const);
  applyDirective(app);
  const vnode = createVNode(input._component, input._props, slots as any);
  const instance = createComponentInstance(vnode, input._instance, null);
  instance.appContext = input._context;
  // @ts-expect-error vue internal API
  instance.provides = /* @__PURE__ */ Object.create(input._context.provides);

  const componentType = input._component as Component & {
    __onigiriRender?: (ctx: any, slots: any) => VServerComponentBuffered;
  };

  return app.runWithContext(async () => {
    const res = await setupComponent(instance, true);

    return await app.runWithContext(async () => {
      const hasAsyncSetup = isPromise(res);
      let prefetches =
        // @ts-expect-error internal API
        instance.sp as unknown as Promise[] | undefined;

      if (hasAsyncSetup || prefetches) {
        await Promise.resolve(res).then(() => {
          if (hasAsyncSetup) {
            // @ts-expect-error internal API
            prefetches = instance.sp;
          }
          if (prefetches) {
            return Promise.all(prefetches.map((prefetch) => prefetch.call(instance.proxy)));
          }
        });
      }

      const taggedRootRender = pickTaggedRender(instance);
      if (taggedRootRender) {
        const injectRendered = app.runWithContext(() =>
          taggedRootRender.call(instance.proxy, instance.proxy, instance),
        );
        if (isPromise(injectRendered)) {
          const r = await injectRendered;
          return unrollServerComponentBufferPromises(r as VServerComponentBuffered);
        }
        return unrollServerComponentBufferPromises(injectRendered as VServerComponentBuffered);
      }

      if (typeof componentType.__onigiriRender === "function") {
        const result = app.runWithContext(() =>
          runOnigiriRender(componentType.__onigiriRender!, instance),
        );
        return unrollServerComponentBufferPromises(result);
      }

      const child = renderComponentRoot(instance);
      const result = await app.runWithContext(() => serializeVNode(child, instance));
      if (result) {
        return unrollServerComponentBufferPromises(result);
      }
    });
  });
}

async function unrollSlotsObject(slots: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await Promise.all(
    Object.entries(slots).map(async ([key, value]) => {
      if (isPromise(value)) {
        const resolved = await value;
        out[key] = Array.isArray(resolved)
          ? await unrollServerComponentBufferPromises(resolved as VServerComponentBuffered)
          : resolved;
      } else if (Array.isArray(value)) {
        out[key] = await unrollServerComponentBufferPromises(value as VServerComponentBuffered);
      } else {
        out[key] = value;
      }
    }),
  );
  return out;
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
  // Index 4 of a `[Component, ...]` tuple is the slots object — recurse
  // into it specifically so Promises in slot bodies get awaited.
  const isComponentTuple =
    Array.isArray(buffer) && (buffer as any)[0] === VServerComponentType.Component;

  for (const i in buffer) {
    const item = buffer[i];
    if (isPromise(item)) {
      promises.push(
        item.then((r) => {
          if (Array.isArray(r)) {
            return Promise.all(r.map((v) => unrollServerComponentBufferPromises(v))).then(
              (unrolled) => {
                result[i] = unrolled;
              },
            );
          }

          result[i] = r;
          return r;
        }),
      );
    } else if (Array.isArray(item)) {
      promises.push(
        Promise.all(
          item.map((v) => {
            if (isPromise(v)) {
              return v.then((resolved) => {
                if (resolved && Array.isArray(resolved)) {
                  return unrollServerComponentBufferPromises(resolved as VServerComponentBuffered);
                }
                return resolved;
              });
            }
            if (Array.isArray(v)) {
              return unrollServerComponentBufferPromises(v as VServerComponentBuffered);
            }
            return v;
          }),
        ).then((unrolled) => {
          result[i] = unrolled;
        }),
      );
    } else if (
      isComponentTuple &&
      i === "4" &&
      item &&
      typeof item === "object" &&
      !Array.isArray(item)
    ) {
      promises.push(
        unrollSlotsObject(item as Record<string, unknown>).then((unrolled) => {
          result[i] = unrolled as any;
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
      const componentType = vnode.type as Component & {
        __onigiriRender?: (ctx: any, slots: any) => VServerComponentBuffered;
      };
      if (typeof componentType.__onigiriRender === "function") {
        const instance = createComponentInstance(vnode, parentInstance ?? null, null);
        inheritAppContext(instance, parentInstance);
        const res = setupComponent(instance, true);

        const runPicked = (): any => {
          const tagged = pickTaggedRender(instance);
          if (tagged) {
            return tagged.call(instance.proxy, instance.proxy, instance);
          }
          return runOnigiriRender(componentType.__onigiriRender!, instance);
        };

        if (isPromise(res)) {
          return res.then(async () => {
            // @ts-expect-error internal API
            const prefetches = instance.sp as unknown as Promise[] | undefined;
            if (prefetches) {
              await Promise.all(prefetches.map((prefetch) => prefetch.call(instance.proxy)));
            }
            return runPicked();
          });
        }

        // @ts-expect-error internal API
        const prefetches = instance.sp as unknown as Promise[] | undefined;
        if (prefetches) {
          await Promise.all(prefetches.map((prefetch) => prefetch.call(instance.proxy)));
        }

        return runPicked();
      }

      return Promise.resolve(renderComponent(vnode, parentInstance)).then((child) => {
        // @ts-expect-error
        if (child._onigiriLoadClient) {
          const componentName =
            (vnode.type as any)?.__name ?? (vnode.type as any)?.name ?? "anonymous";
          throw new Error(
            `[vue-onigiri] Component "${componentName}" uses v-load-client outside an onigiri-compiled template. ` +
              `v-load-client only works on components rendered through the onigiri compiler — Vue's vnode-tree fallback ` +
              `has no compile-time path to point the client at. Render this component from a .vue file processed by onigiriCompilerPlugin.`,
          );
        }

        return [VServerComponentType.Fragment, serializeChildren(child, parentInstance)];
      });
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
      return [VServerComponentType.Fragment, serializeChildren(vnode.children, parentInstance)];
    }
  } else if (vnode && (typeof vnode === "string" || typeof vnode === "number")) {
    return [VServerComponentType.Text, vnode as string];
  }
}

function serializeChildren(
  children?: VNodeNormalizedChildren | VNode,
  parentInstance?: ComponentInternalInstance,
): Promise<VServerComponentBuffered[]> | VServerComponentBuffered[] | undefined {
  if (!children) {
    return;
  }

  if (isVNode(children)) {
    return serializeChildren([children], parentInstance);
  }

  if (Array.isArray(children)) {
    return Promise.all(children.map((vnode) => serializeVNode(vnode, parentInstance))).then(
      (vnodes) => vnodes.filter(Boolean) as VServerComponentBuffered[],
    );
  }
  if (typeof children === "string" || typeof children === "number") {
    return [[VServerComponentType.Text, children as string]];
  }
}

function renderComponent(
  _vnode: VNode,
  parentInstance?: ComponentInternalInstance | null,
): Promise<VNodeNormalizedChildren | VNode> | VNodeNormalizedChildren | VNode {
  const instance = createComponentInstance(_vnode, parentInstance ?? null, null);
  const children = instance.vnode.children;
  const reconstructedSlots: Record<string, any> = {};
  if (children && typeof children === "object" && !Array.isArray(children)) {
    for (const key in children) {
      const fn = (children as Record<string, any>)[key];
      if (typeof fn !== "function") {
        reconstructedSlots[key] = fn;
        continue;
      }
      reconstructedSlots[key] = (...args: any[]) => {
        const result = fn(...args);
        instance.__slotsResult = instance.__slotsResult || {};
        instance.__slotsResult[key] = result;
        return result;
      };
    }
  }
  instance.vnode.children = reconstructedSlots;
  const res = setupComponent(instance, true);
  const hasAsyncSetup = isPromise(res);
  let prefetches =
    // @ts-expect-error internal API
    instance.sp as unknown as Promise[]; /* LifecycleHooks.SERVER_PREFETCH */

  if (hasAsyncSetup || prefetches) {
    const p: Promise<unknown> = Promise.resolve(res).then(() => {
      if (hasAsyncSetup) {
        // @ts-expect-error internal API
        prefetches = instance.sp;
      }
      if (prefetches) {
        return Promise.all(prefetches.map((prefetch) => prefetch.call(instance.proxy)));
      }
    });
    return p.then(() => {
      const vnode = renderComponentRoot(instance);
      const { dirs, props } = vnode;
      if (dirs) {
        vnode.props = applySSRDirectives(vnode, props, dirs);
      }
      vnode.__slotsResult = instance.__slotsResult;
      if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
        return renderComponent(vnode, parentInstance);
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
  return isVNode(child.children) ? child.children : child;
}

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
      ([key, _]) => !(key.startsWith("on") && key[2] && key[2].toUpperCase() === key[2]),
    ),
  );
}
