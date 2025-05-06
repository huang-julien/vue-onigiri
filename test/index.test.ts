import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ElementsOnly from "./fixtures/ElementsOnly.vue";
import { renderAsServerComponent } from "../src";
import { defineComponent, h } from "vue";
import { renderServerComponent } from "../src/deserialize";

describe("packageName", () => {
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
});
