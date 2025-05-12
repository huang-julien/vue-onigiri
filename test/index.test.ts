import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementsOnly from "./fixtures/ElementsOnly.vue";
import { renderAsServerComponent } from "../src";
import { defineComponent, h, nextTick } from "vue";
import { renderServerComponent } from "../src/deserialize";
import LoadComponent from "./fixtures/LoadComponent.vue";

describe("serialize/deserialize", () => {
  it('expect to parse and render a component with only elements', async () => {
    const wrapper = mount(ElementsOnly)
    const vnode = wrapper.vm.$.vnode.component!.vnode
    const { html, ast } = await renderAsServerComponent(vnode)

    expect(html).toMatchInlineSnapshot(`"<div><div>1</div><div>2</div><div>0</div></div>"`)
    expect(ast).toMatchInlineSnapshot(`
      {
        "children": {
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
        },
        "type": 3,
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
      const { html, ast } = await renderAsServerComponent(vnode)
      expect(html).toMatchInlineSnapshot(`"<div><div>1</div><div>2</div><div loadclientside load:client> counter : 0 <button>Increment</button></div></div>"`)

      expect(ast).toMatchInlineSnapshot(`
        {
          "children": {
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
                  "children": [
                    {
                      "children": {
                        "text": "Increment",
                        "type": 2,
                      },
                      "props": {
                        "onClick": [Function],
                      },
                      "tag": "button",
                      "type": 0,
                    },
                  ],
                  "props": {
                    "load:client": "",
                    "loadClientSide": "",
                  },
                  "tag": "div",
                  "type": 0,
                },
                "chunk": "/test/fixtures/Counter.vue",
                "props": {
                  "load:client": "",
                  "loadClientSide": "",
                },
                "type": 1,
              },
            ],
            "props": undefined,
            "tag": "div",
            "type": 0,
          },
          "type": 3,
        }
      `)
      wrapper.unmount()
      const clientSide = mount(defineComponent({
        setup() {
          return () => renderServerComponent(ast)
        }
      }))
      await flushPromises()
      await nextTick()
      const rebuiltHtml = clientSide.html().replaceAll(/\r?\n| |=""/g, '')
      expect(rebuiltHtml).toMatchInlineSnapshot(`"<div><div>1</div><div>2</div><divloadclientsideload:client>counter:0<button>Increment</button></div></div>"`)
      expect(rebuiltHtml).toEqual(html.replaceAll(/\r?\n| |=""/g, ''))

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
