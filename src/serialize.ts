import type { SSRContext, } from "@vue/server-renderer";
// @ts-expect-error ssrUtils is not a public API
import { createVNode, isVNode, type App, type VNode, type VNodeChild, type VNodeNormalizedChildren, ssrUtils, type ComponentInternalInstance, type SuspenseBoundary, type DefineComponent, createApp, Suspense, h, ssrContextKey, defineComponent } from "vue";
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
    renderComponentRoot: (instance: ComponentInternalInstance) => VNode;
} = ssrUtils;

export async function serializeComponent(component: DefineComponent, props: any, context: SSRContext = {}) {
    const input = createApp(component, props)
    const vnode = createVNode(input._component, input._props)
    vnode.appContext = input._context

    const instance = createComponentInstance(vnode, input._instance, null);
    const res = await setupComponent(instance, true);
    const hasAsyncSetup = isPromise(res)
    // @ts-expect-error internal API
    let prefetches = instance.sp as unknown as Promise[]/* LifecycleHooks.SERVER_PREFETCH */


    const child = renderComponentRoot(instance);

    if (hasAsyncSetup || prefetches) {
        const p: Promise<unknown> = Promise.resolve(res)
            .then(() => {
                // instance.sp may be null until an async setup resolves, so evaluate it here
                // @ts-expect-error internal API
                if (hasAsyncSetup) prefetches = instance.sp
                if (prefetches) {
                    return Promise.all(
                        prefetches.map(prefetch => prefetch.call(instance.proxy)),
                    )
                }
            })
        await p
    }
    return renderVNode(child)
}

export async function renderToAST(input: App, context: SSRContext) {
    const vnode = createVNode(input._component, input._props)
    vnode.appContext = input._context

    const instance = createComponentInstance(vnode, null, null);
    await setupComponent(instance, true);
    const child = renderComponentRoot(instance);


    return renderVNode(child)
}

export async function renderVNode(vnode: VNodeChild, parentInstance?: ComponentInternalInstance): Promise<VServerComponent | undefined> {
    if (isVNode(vnode)) {
        if (vnode.shapeFlag & ShapeFlags.ELEMENT) {
            return {
                type: VServerComponentType.Element,
                tag: vnode.type as string,
                props: vnode.props ?? undefined,
                children: await renderChild(vnode.children || vnode.component?.subTree || vnode.component?.vnode.children, parentInstance),
            }
        } else if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
            const instance = createComponentInstance(vnode, parentInstance ?? null, null)
            const res = await setupComponent(instance, true)
            const hasAsyncSetup = isPromise(res)
            // @ts-expect-error internal API
            let prefetches = instance.sp as unknown as Promise[]/* LifecycleHooks.SERVER_PREFETCH */

            const child = renderComponentRoot(instance)

            if (hasAsyncSetup || prefetches) {
                const p: Promise<unknown> = Promise.resolve(res)
                    .then(() => {
                        // instance.sp may be null until an async setup resolves, so evaluate it here
                        // @ts-expect-error internal API
                        if (hasAsyncSetup) { prefetches = instance.sp }
                        if (prefetches) {
                            return Promise.all(
                                prefetches.map(prefetch => prefetch.call(instance.proxy)),
                            )
                        }
                    })
                await p
            }

            if (vnode.props && 'load:client' in vnode.props && vnode.props['load:client'] !== false) {
                return {
                    type: VServerComponentType.Component,
                    props: vnode.props ?? undefined,
                    children: await renderChild(child.children || child.component?.subTree || child.component?.vnode.children, parentInstance),
                    // @ts-expect-error 
                    chunk: vnode.type.__chunk as string,
                }
            }
            return {
                type: VServerComponentType.Fragment,
                children: await renderChild(child, parentInstance),
            }
        }
        // handle suspense
        else if (vnode.shapeFlag & ShapeFlags.SUSPENSE) {
            return {
                type: VServerComponentType.Suspense,
                // @ts-expect-error internal API
                children: await renderChild(vnode.ssContent, parentInstance),
            }
        } else if (vnode.type === Text) {
            return {
                type: VServerComponentType.Text,
                text: vnode.children as string,
            }
        }
    } else if (vnode && (typeof vnode === 'string' || typeof vnode === 'number')) {
        return {
            type: VServerComponentType.Text,
            text: vnode as string,
        }
    }
}

async function renderChild(children?: VNodeNormalizedChildren | VNode, parentInstance?: ComponentInternalInstance): Promise<VServerComponent[] | VServerComponent | undefined> {
    if (!children) {
        return
    }

    if (isVNode(children)) {
        return await renderVNode(children, parentInstance)
    }

    if (Array.isArray(children)) {
        return (await Promise.all(children.map(vnode => renderVNode(vnode, parentInstance)))).filter((v): v is VServerComponent => !!v)
    }

    if (typeof children === 'string' || typeof children === 'number') {
        return {
            type: VServerComponentType.Text,
            text: children as string,
        }
    }
}
