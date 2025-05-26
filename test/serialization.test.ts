// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementsOnly from "./fixtures/components/ElementsOnly.vue";
import { defineComponent, h, nextTick, provide, Suspense } from "vue";
import { renderServerComponent } from "../src/runtime/deserialize";
import LoadComponent from "./fixtures/components/LoadComponent.vue";
import { serializeComponent } from "../src/runtime/serialize";
import AsyncComponent from "./fixtures/components/AsyncComponent.vue";
import WithAsyncComponent from "virtual:vsc:./fixtures/components/WithAsyncComponent.vue";
import SlotToCounter from "virtual:vsc:./fixtures/components/SlotToCounter.vue";
import WithSuspense from "virtual:vsc:./fixtures/components/WithSuspense.vue";
import { removeCommentsFromHtml } from "./utils";
import { VServerComponentType, type VServerComponent } from "../src/runtime/shared";
import { renderToString } from "@vue/server-renderer";

describe("serialize/deserialize", () => {
  it('expect to parse and render a component with only elements', async () => {
    const wrapper = mount(ElementsOnly)
    const vnode = wrapper.vm.$.vnode.component!.vnode
    const ast = await serializeComponent(ElementsOnly)
    const html = await renderToString(vnode)
    expect(html).toMatchInlineSnapshot(`"<div><div>1</div><div>2</div><div>0</div></div>"`)
    expect(ast).toMatchInlineSnapshot(`
      {
        "children": [
          {
            "children": {
              "text": "1",
              "type": 2,
            },
            "props": undefined,
            "tag": "div",
            "type": 0,
          },
          {
            "children": {
              "text": "2",
              "type": 2,
            },
            "props": undefined,
            "tag": "div",
            "type": 0,
          },
          {
            "children": {
              "text": "0",
              "type": 2,
            },
            "props": undefined,
            "tag": "div",
            "type": 0,
          },
        ],
        "props": undefined,
        "tag": "div",
        "type": 0,
      }
    `)
    wrapper.unmount()
    const clientSide = mount(defineComponent({
      setup() {
        return () => renderServerComponent(ast)
      }
    }))
    const rebuiltHtml = clientSide.html().replaceAll(/\r?\n| /g, '')
    expect(rebuiltHtml).toMatchInlineSnapshot(`"<div><div>1</div><div>2</div><div>0</div></div>"`)
    expect(rebuiltHtml).toEqual(html)
  })



  describe('load components', () => {
    it('should render a component with loadClientSide prop', async () => {

      const wrapper = mount(LoadComponent)
      const vnode = wrapper.vm.$.vnode.component!.vnode

      const ast = await serializeComponent(LoadComponent)
      const html = await renderToString(vnode)
      expect(removeCommentsFromHtml(html)).toMatchInlineSnapshot(`"<div><div>1</div><div>2</div><div loadclientside load:client> counter : 0 <button>Increment</button></div></div>"`)

      expect(ast).toMatchInlineSnapshot(`
        {
          "children": [
            {
              "children": {
                "text": "1",
                "type": 2,
              },
              "props": undefined,
              "tag": "div",
              "type": 0,
            },
            {
              "children": {
                "text": "2",
                "type": 2,
              },
              "props": undefined,
              "tag": "div",
              "type": 0,
            },
            {
              "chunk": "/test/fixtures/components/Counter.vue",
              "props": {
                "load:client": "",
                "loadClientSide": "",
              },
              "slots": {},
              "type": 1,
            },
          ],
          "props": undefined,
          "tag": "div",
          "type": 0,
        }
      `)
      wrapper.unmount()
      const clientSide = mount(defineComponent({
        setup() {
          return () => h(Suspense, {}, {
            default: () => renderServerComponent(ast)
          })
        }
      }))
      await flushPromises()
      await nextTick()
      const rebuiltHtml = removeCommentsFromHtml(clientSide.html().replaceAll(/\r?\n| |=""/g, ''))
      expect(removeCommentsFromHtml(rebuiltHtml)).toMatchInlineSnapshot(`"<div><div>1</div><div>2</div><divloadclientsideload:client>counter:0<button>Increment</button></div></div>"`)
      expect(rebuiltHtml).toEqual(removeCommentsFromHtml(html).replaceAll(/\r?\n| |=""/g, ''))

      await clientSide.find('button').trigger('click')
      await flushPromises()
      await nextTick()
      expect(clientSide.html()).contain('1')
      expect(clientSide.html()).toMatchInlineSnapshot(`
        "<div>
          <div>1</div>
          <div>2</div>
          <div loadclientside="" load:client=""> counter : 1 <button>Increment</button></div>
        </div>"
      `)
    })
  })
});

describe('Async components', () => {
  it('should serialize async component', async () => {
    const { promise, resolve } = Promise.withResolvers()
    const ast = await serializeComponent(AsyncComponent, { v: 'some text' })
    const wrapper = mount({
      render() {
        return h(Suspense, {
          onResolve: () => resolve(true)
        }, {
          default: h(AsyncComponent, {

            v: 'some text'

          })
        })
      }
    })
    expect(ast).toMatchInlineSnapshot(`
      {
        "children": {
          "text": "Hello world ! some text",
          "type": 2,
        },
        "props": undefined,
        "tag": "div",
        "type": 0,
      }
    `)
    await flushPromises()
    await promise
    await nextTick()
    const html = wrapper.html()
    expect(html).toMatchInlineSnapshot(`"<div>Hello world ! some text</div>"`)
    wrapper.unmount()
    const rebuilt = mount({
      render: () => renderServerComponent(ast)
    })
    await flushPromises()
    expect(rebuilt.html()).toMatchInlineSnapshot(`"<div>Hello world ! some text</div>"`)
    expect(rebuilt.html()).toBe(html)

  })

  it('handles nested async component', async () => {
    const ast = await serializeComponent(WithAsyncComponent, {})
    expect(ast).toMatchInlineSnapshot(`
      {
        "children": [
          {
            "text": " component with suspense ",
            "type": 2,
          },
          {
            "children": {
              "children": {
                "text": "Hello world ! yolo",
                "type": 2,
              },
              "props": undefined,
              "tag": "div",
              "type": 0,
            },
            "type": 3,
          },
        ],
        "props": undefined,
        "tag": "div",
        "type": 0,
      }
    `)
  })

  it('handles nested async component with suspense', async () => {
    const ast = await serializeComponent(WithSuspense, {})
    expect(ast).toMatchInlineSnapshot(`
      {
        "children": [
          {
            "text": " component with suspense ",
            "type": 2,
          },
          {
            "children": {
              "children": {
                "children": {
                  "text": "Hello world ! yolo",
                  "type": 2,
                },
                "props": undefined,
                "tag": "div",
                "type": 0,
              },
              "type": 3,
            },
            "type": 4,
          },
        ],
        "props": undefined,
        "tag": "div",
        "type": 0,
      }
    `)
  })
})

describe('revive', () => {


  describe('injection', () => {
    it('should injection be working when reviving', async () => {
      const key = 'test'

      const { promise, resolve } = Promise.withResolvers()

      const ast: VServerComponent = {
        type: VServerComponentType.Component,
        chunk: '/test/fixtures/components/Injection.vue',
      }

      const wrapper = mount({
        setup() {
          provide(key, 'Success !')
          return () => h(Suspense, { onResolve: () => resolve(true) }, {
            default: () => renderServerComponent(ast)
          })
        }
      })
      await promise
      await flushPromises()
      await nextTick()
      const html = wrapper.html()
      expect(html).toMatchInlineSnapshot(`"<div> injection: Success !</div>"`)
    })
  })

})

describe('slots', () => {
    it('should send slots into Counter', async () => {
        const ast = await serializeComponent(SlotToCounter)

        expect(ast).toMatchInlineSnapshot(`
          {
            "children": [
              {
                "chunk": "/test/fixtures/components/Counter.vue",
                "props": {
                  "load:client": "",
                  "loadClientSide": "",
                },
                "slots": {
                  "default": {
                    "children": [
                      {
                        "children": [
                          {
                            "children": {
                              "text": "Slot to Counter: 0",
                              "type": 2,
                            },
                            "props": undefined,
                            "tag": "p",
                            "type": 0,
                          },
                        ],
                        "props": undefined,
                        "tag": "div",
                        "type": 0,
                      },
                    ],
                    "type": 3,
                  },
                },
                "type": 1,
              },
            ],
            "props": undefined,
            "tag": "div",
            "type": 0,
          }
        `)
    })
})