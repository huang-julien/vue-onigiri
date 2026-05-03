// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementsOnly from './fixtures/components/ElementsOnly.vue'
import { defineComponent, h, nextTick, provide, Suspense } from 'vue'
import { renderOnigiri } from '../src/runtime/deserialize'
import LoadComponent from './fixtures/components/LoadComponent.vue'
import { serializeComponent } from '../src/runtime/serialize'
import AsyncComponent from './fixtures/components/AsyncComponent.vue'
import WithAsyncComponent from './fixtures/components/WithAsyncComponent.vue'
import SlotToCounter from './fixtures/components/SlotToCounter.vue'
import WithSuspense from './fixtures/components/WithSuspense.vue'
import { removeCommentsFromHtml } from './utils'
import {
  VServerComponentType,
  type VServerComponent,
} from '../src/runtime/shared'
import { renderToString } from '@vue/server-renderer'

describe('serialize/deserialize', () => {
  it('expect to parse and render a component with only elements', async () => {
    const ast = await serializeComponent(ElementsOnly)
    const html = await renderToString(h(ElementsOnly))
    expect(html).toMatchInlineSnapshot(
      `"<div><div>1</div><div>2</div><div>0</div></div>"`,
    )

    expect(ast).toMatchInlineSnapshot(`
      [
        0,
        "div",
        undefined,
        [
          [
            0,
            "div",
            undefined,
            [
              [
                2,
                "1",
              ],
            ],
          ],
          [
            0,
            "div",
            undefined,
            [
              [
                2,
                "2",
              ],
            ],
          ],
          [
            0,
            "div",
            undefined,
            [
              [
                2,
                0,
              ],
            ],
          ],
        ],
      ]
    `)
    const clientSide = mount(
      defineComponent({
        setup() {
          return () => renderOnigiri(ast)
        },
      }),
    )
    const rebuiltHtml = clientSide.html().replaceAll(/\r?\n| /g, '')
    expect(rebuiltHtml).toMatchInlineSnapshot(
      `"<div><div>1</div><div>2</div><div>0</div></div>"`,
    )
    expect(rebuiltHtml).toEqual(html)
  })

  describe('load components', () => {
    it('should render a component with loadClientSide prop', async () => {
      const ast = await serializeComponent(LoadComponent)
      const html = await renderToString(h(LoadComponent))
      expect(removeCommentsFromHtml(html)).toMatchInlineSnapshot(
        `"<div><div>1</div><div>2</div><div> counter : 0 <button>Increment</button></div></div>"`,
      )

      const { promise, resolve } = Promise.withResolvers()

      expect(ast).toMatchInlineSnapshot(`
        [
          0,
          "div",
          undefined,
          [
            [
              0,
              "div",
              undefined,
              [
                [
                  2,
                  "1",
                ],
              ],
            ],
            [
              0,
              "div",
              undefined,
              [
                [
                  2,
                  "2",
                ],
              ],
            ],
            [
              1,
              undefined,
              "/test/fixtures/components/Counter.vue",
              "default",
              undefined,
            ],
          ],
        ]
      `)
      const clientSide = mount(
        defineComponent({
          setup() {
            return () =>
              h(
                Suspense,
                {
                  onResolve: () => resolve(true),
                },
                {
                  default: () => renderOnigiri(ast),
                },
              )
          },
        }),
      )
      await promise
      await flushPromises()
      await nextTick()
      const rebuiltHtml = removeCommentsFromHtml(
        clientSide.html().replaceAll(/\r?\n| |=""/g, ''),
      )
      expect(removeCommentsFromHtml(rebuiltHtml)).toMatchInlineSnapshot(
        `"<div><div>1</div><div>2</div><div>counter:0<button>Increment</button></div></div>"`,
      )
      expect(rebuiltHtml).toEqual(
        removeCommentsFromHtml(html).replaceAll(/\r?\n| |=""/g, ''),
      )

      await clientSide.find('button').trigger('click')
      await flushPromises()
      await nextTick()
      expect(clientSide.html()).contain('1')
      expect(clientSide.html()).toMatchInlineSnapshot(`
        "<div>
          <div>1</div>
          <div>2</div>
          <div> counter : 1 <button>Increment</button></div>
        </div>"
      `)
    })
  })
})

describe('Async components', () => {
  it('should serialize async component', async () => {
    const ast = await serializeComponent(AsyncComponent, { v: 'some text' })
    const html = await renderToString(
      h(AsyncComponent, {
        v: 'some text',
      }),
    )
    expect(ast).toMatchInlineSnapshot(`
      [
        0,
        "div",
        undefined,
        [
          [
            2,
            "Hello world ! some text",
          ],
        ],
      ]
    `)
    await flushPromises()
    await nextTick()
    expect(html).toMatchInlineSnapshot(`"<div>Hello world ! some text</div>"`)
    const rebuilt = mount({
      render: () => renderOnigiri(ast),
    })
    await flushPromises()
    expect(rebuilt.html()).toMatchInlineSnapshot(
      `"<div>Hello world ! some text</div>"`,
    )
    expect(rebuilt.html()).toBe(html)
  })

  it('handles nested async component', async () => {
    const ast = await serializeComponent(WithAsyncComponent, {})

    expect(ast).toMatchInlineSnapshot(`
      [
        0,
        "div",
        undefined,
        [
          [
            2,
            " component with suspense ",
          ],
          [
            0,
            "div",
            undefined,
            [
              [
                2,
                "Hello world ! yolo",
              ],
            ],
          ],
        ],
      ]
    `)
  })

  it('handles nested async component with suspense', async () => {
    const ast = await serializeComponent(WithSuspense, {})

    expect(ast).toMatchInlineSnapshot(`
      [
        0,
        "div",
        undefined,
        [
          [
            2,
            " component with suspense ",
          ],
          [
            4,
            [
              [
                0,
                "div",
                undefined,
                [
                  [
                    2,
                    "Hello world ! yolo",
                  ],
                ],
              ],
            ],
          ],
        ],
      ]
    `)
  })
})

describe('revive', () => {
  describe('injection', () => {
    it('should injection be working when reviving', async () => {
      const key = 'test'

      const { promise, resolve } = Promise.withResolvers()

      const ast: VServerComponent = [
        VServerComponentType.Component,
        undefined,
        '/test/fixtures/components/Injection.vue',
        undefined,
      ]

      const wrapper = mount({
        setup() {
          provide(key, 'Success !')
          return () =>
            h(
              Suspense,
              { onResolve: () => resolve(true) },
              {
                default: () => renderOnigiri(ast),
              },
            )
        },
      })
      await promise
      // Inner Suspense (in the Loader) needs its async load to settle
      // after the outer Suspense resolves. Poll until the rendered HTML
      // contains the expected content rather than guessing tick counts.
      for (let i = 0; i < 20 && !wrapper.html().includes('Success'); i++) {
        await flushPromises()
        await nextTick()
        await new Promise(r => setTimeout(r, 10))
      }
      const html = wrapper.html()
      expect(html).toMatchInlineSnapshot(`"<div>injection: Success !</div>"`)
    })
  })
})

describe('slots', () => {
  it('should send slots into Counter', async () => {
    const ast = await serializeComponent(SlotToCounter)

    expect(ast).toMatchInlineSnapshot(`
      [
        0,
        "div",
        undefined,
        [
          [
            1,
            undefined,
            "/test/fixtures/components/Counter.vue",
            "default",
            {
              "default": [
                0,
                "div",
                undefined,
                [
                  [
                    0,
                    "p",
                    undefined,
                    [
                      [
                        2,
                        "Slot content (static)",
                      ],
                    ],
                  ],
                ],
              ],
            },
          ],
        ],
      ]
    `)
    // Wrap in Suspense so async loader setup resolves before rendering.
    const astHtml = await renderToString(
      h(Suspense, null, { default: () => renderOnigiri(ast) }),
    )
    expect(removeCommentsFromHtml(astHtml)).toMatchInlineSnapshot(
      `"<div><div> counter : 0 <button>Increment</button><div><p>Slot content (static)</p></div></div></div>"`,
    )
    const html = await renderToString(h(SlotToCounter))
    expect(removeCommentsFromHtml(html)).toMatchInlineSnapshot(
      `"<div><div> counter : 0 <button>Increment</button><div><p>Slot content (static)</p></div></div></div>"`,
    )
    expect(removeCommentsFromHtml(html)).toEqual(
      removeCommentsFromHtml(astHtml),
    )
  })
})
