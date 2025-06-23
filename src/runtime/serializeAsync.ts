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
import { type VServerComponentBuffered, VServerComponentType, type VServerComponent } from "./shared";
import type { MaybePromise } from "rollup";

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
    return renderVNode(child).then((result) => {
        if (result) {
            return unrollServerComponentBufferPromises(result);
        }
    });
}

export function serializeApp(app: App, context: SSRContext = {}) {
    const input = app;
    app.provide(ssrContextKey, context);

    const vnode = createVNode(input._component, input._props);
    // vnode.appContext = input._context
    const instance = createComponentInstance(vnode, input._instance, null);
    instance.appContext = input._context;

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

                return p.then(() => renderVNode(child, instance).then((result) => {
                    if (result) {
                        return unrollServerComponentBufferPromises(result);
                    }
                }));
            }
            return renderVNode(child, instance).then((result) => {
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
        })
    }
    const result = [] as unknown as VServerComponent
    const promises: Promise<any>[] = [];

    for (const i in buffer) {
        const item = buffer[i];
        if (isPromise(item)) {
            promises.push(item.then((r) => {
                if(Array.isArray(r)) {
                    return Promise.all(r.map(
                        (v) => unrollServerComponentBufferPromises(v)
                    )).then((unrolled) => {
                        result[i] = unrolled;
                    })
                }
                
                        result[i] = r;
                return r
            }));
        } else {
            result[i] = item as VServerComponent;
        }
    }
    return Promise.all(promises).then(() => result);
}

export async function renderVNode(
    vnode: VNodeChild,
    parentInstance?: ComponentInternalInstance,
): Promise<VServerComponentBuffered | undefined> {
    if (isVNode(vnode)) {
        if (vnode.shapeFlag & ShapeFlags.ELEMENT) {
            return [
                VServerComponentType.Element,
                vnode.type as string,
                vnode.props ?? undefined,
                renderChild(vnode.children, parentInstance),
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
                        renderSlots(child.ctx?.__slotsResult),
                    ];
                }
                console.warn("Component is missing chunk information");
            }

            return [
                VServerComponentType.Fragment,
                renderChild(child.children, parentInstance),
            ];
        }
        // handle suspense
        else if (vnode.shapeFlag & ShapeFlags.SUSPENSE) {
            return [
                VServerComponentType.Suspense,
                // @ts-expect-error internal API
                renderChild(vnode.ssContent, parentInstance),
            ];
        } else if (vnode.type === Text) {
            return [VServerComponentType.Text, vnode.children as string];
        } else if (vnode.type === Fragment) {
            return [
                VServerComponentType.Fragment,
                renderChild(vnode.children, parentInstance),
            ];
        }
    } else if (
        vnode &&
        (typeof vnode === "string" || typeof vnode === "number")
    ) {
        return [VServerComponentType.Text, vnode as string];
    }
}

function renderChild(
    children?: VNodeNormalizedChildren | VNode,
    parentInstance?: ComponentInternalInstance,
): Promise<VServerComponentBuffered[]> | VServerComponentBuffered[] | undefined {
    if (!children) {
        return;
    }

    if (isVNode(children)) {
        return renderChild([children], parentInstance);
    }

    if (Array.isArray(children)) {
        return (
            Promise.all(children.map((vnode) => renderVNode(vnode, parentInstance))).then(
                (vnodes) => vnodes.filter(Boolean) as VServerComponentBuffered[],
            )
        );
    }
    if (typeof children === "string" || typeof children === "number") {
        return [[VServerComponentType.Text, children as string]];
    }
}

function renderSlots(
    slots: Record<string, VNode> | undefined,
): MaybePromise<Record<string, VServerComponent[] | undefined>> | undefined {
    if (!slots) {
        return {};
    }
    const result: MaybePromise<Record<string, VServerComponent[] | undefined>> | undefined = {};
    const promises  : Promise<any>[] = [];
    for (const key in slots) {
        const slot = slots[key];
        if (Array.isArray(slot)) {
            const r = (
                Promise.all(slot.map((vnode) => renderVNode(vnode))).then(
                    (vnodes) => vnodes.filter(Boolean) as VServerComponentBuffered,
                ).then((v) => {
                    return unrollServerComponentBufferPromises(v).then(v => {
                        return (result[key] = [v]);
                    });
                })
            );
            promises.push(r);
        } else if (isVNode(slot)) {
            const r = renderVNode(slot);
            if (r) {
                promises.push(
                    r.then(v => {
                        if(v) {
                            return  unrollServerComponentBufferPromises(v)
                    .then((v) => {
                        result[key] = [v];
                    })
                        }
                    })
                );
            }
        } else {
            console.warn(`Unexpected slot type: ${typeof slot} for key: ${key}`);
        }
    }
    return Promise.all(promises).then(() => result);
}

  function renderComponent(
    vnode: VNode,
    parentInstance?: ComponentInternalInstance | null,
) {
    const instance = createComponentInstance(vnode, parentInstance ?? null, null);
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
            return renderComponentRoot(instance);
         })
    }
    return renderComponentRoot(instance);
}
