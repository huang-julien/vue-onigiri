import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementsOnly from "./fixtures/components/ElementsOnly.vue";
import { renderAsServerComponent } from "../src";
import { defineComponent, h, nextTick, Suspense } from "vue";
import { renderServerComponent } from "../src/deserialize";
import LoadComponent from "./fixtures/components/LoadComponent.vue";
import { serializeComponent } from "../src/serialize";
import AsyncComponent from "./fixtures/components/AsyncComponent.vue";
import WithAsyncComponent from "virtual:vsc:./test/fixtures/components/WithAsyncComponent.vue";

import WithSuspense from "virtual:vsc:./test/fixtures/components/WithSuspense.vue";

 

describe('Async components', () => {
  it('should serialize async component', async () => {
    const { promise, resolve } = Promise.withResolvers()
    const ast = await serializeComponent(AsyncComponent, {v: 'some text'})
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
    const html= wrapper.html()
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
})
 
