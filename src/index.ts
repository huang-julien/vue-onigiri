import type { SSRContext, } from "@vue/server-renderer"
import type { App, VNode } from "vue"
import { isVNode, createApp, } from "vue"
import { renderToString, renderVNode } from "@vue/server-renderer"
import { renderToAST } from "./serialize"

export async function renderAsServerComponent(
  input: App | VNode,
  context: SSRContext = {},
): Promise<{
  html: string,
  ast: any
}> {

  if (isVNode(input)) {
    // raw vnode, wrap with app (for context)
    return renderAsServerComponent(createApp({ render: () => input }), context)
  }

  const htmlPromise = renderToString(input, context)
  const astPromise = renderToAST(input, context)
  const [html, ast] = await Promise.all([htmlPromise, astPromise])

  return {
    html, ast
  }
}
