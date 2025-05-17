import type { SSRContext,  } from "@vue/server-renderer";
// @ts-expect-error ssrUtils is not a public API
import { createVNode, isVNode, type App, type VNode, type VNodeChild, type VNodeNormalizedChildren, ssrUtils, type ComponentInternalInstance, type SuspenseBoundary, type DefineComponent, createApp, Suspense, h, ssrContextKey, defineComponent } from "vue";
import { isPromise, ShapeFlags } from "@vue/shared";
import { VServerComponentType, type VServerComponent } from "./shared";
 import { ssrRenderComponent } from "@vue/server-renderer"
import { nextTick} from "vue"
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
 
     const instance = createComponentInstance(vnode, null, null);
     const res = await setupComponent(instance, true);
     const hasAsyncSetup = isPromise(res)
     let prefetches = instance.sp as unknown as Promise[]/* LifecycleHooks.SERVER_PREFETCH */

  
     const child = renderComponentRoot(instance);
     
     if(hasAsyncSetup || prefetches) {
        const p: Promise<unknown> = Promise.resolve(res)
        .then(() => {
        // instance.sp may be null until an async setup resolves, so evaluate it here
        if (hasAsyncSetup) prefetches = instance.sp
        if (prefetches) {
          return Promise.all(
            prefetches.map(prefetch => prefetch.call(instance.proxy)),
          )
        }
      })
      await p.then(() => ssrRenderComponent(instance))
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


export async function renderVNode(vnode: VNodeChild): Promise<VServerComponent | undefined> {
    if (isVNode(vnode)) {
        if (vnode.shapeFlag & ShapeFlags.ELEMENT) {
            return {
                type: VServerComponentType.Element,
                tag: vnode.type as string,
                props: vnode.props ?? undefined,
                children: await renderChild(vnode.children || vnode.component?.subTree || vnode.component?.vnode.children),
            }
        } else if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
            if (vnode.props && 'load:client' in vnode.props && vnode.props['load:client'] !== false) {

                return {
                    type: VServerComponentType.Component,
                    props: vnode.props ?? undefined,
                    children: await renderChild(vnode.children || vnode.component?.subTree || vnode.component?.vnode.children),
                    chunk: vnode.type.__chunk as string
                }
            }
            return {
                type: VServerComponentType.Fragment,
                children: await renderChild(vnode.children || vnode.component?.subTree || vnode.component?.vnode.children),
            }
        }
        // handle suspense
        else if (vnode.shapeFlag & ShapeFlags.SUSPENSE) {
            return {
                type: VServerComponentType.Suspense,
                children: await renderChild(vnode.ssContent)
            }
        }
    } else if (typeof vnode === "string" || typeof vnode === "number") {
        return {
            type: VServerComponentType.Text,
            text: vnode as string
        }
    }
}

async function renderChild(children?: VNodeNormalizedChildren | VNode): Promise<VServerComponent[] | VServerComponent | undefined> {
    if (!children) {
        return
    }

    if (isVNode(children)) {
        return renderVNode(children)
    }

    if (Array.isArray(children)) {
        return (await Promise.all(children.map(renderVNode))).filter((v): v is VServerComponent => !!v)
    }

    if (typeof children === "string" || typeof children === "number") {
        return {
            type: VServerComponentType.Text,
            text: children as string
        }
    }
}

