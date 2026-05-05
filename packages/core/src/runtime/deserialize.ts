import { createTextVNode, createStaticVNode, type VNode, h, Fragment, Suspense } from 'vue'
import { VServerComponentType, type VServerComponent } from './shared'
import loader from './loader'

export function renderOnigiri(
  input?: VServerComponent,
): VNode | undefined {
  if (!input) return

  if (input[0] === VServerComponentType.Text) {
    return createTextVNode(input[1])
  }
  if (input[0] === VServerComponentType.Element) {
    return h(
      input[1],
      input[2],
      input[3]?.map(v => renderOnigiri(v as VServerComponent)),
    )
  }
  if (input[0] === VServerComponentType.Component) {
    return h(loader, {
      data: input,
    })
  }
  if (input[0] === VServerComponentType.Fragment) {
    return Array.isArray(input[1])
      ? h(
          Fragment,
          input[1].map(v => renderOnigiri(v)),
        )
      : renderOnigiri(input[1])
  }
  if (input[0] === VServerComponentType.Suspense) {
    return h(
      Suspense,
      {},
      {
        default: () => renderChildren(input[1]),
      },
    )
  }
  if (input[0] === VServerComponentType.StaticHtml) {
    return createStaticVNode(input[1], input[2])
  }
}

export function renderChildren(
  data: VServerComponent[] | undefined,
): VNode | undefined {
  if (!data) return
  return h(
    Fragment,
    data.map(v => renderOnigiri(v)),
  )
}
