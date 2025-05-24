import { it, describe, expect } from "vitest"
import { createApp } from "vue"
import { serializeApp } from "../src/serialize"
import ElementsOnly from "virtual:vsc:./test/fixtures/components/ElementsOnly.vue"
import { renderToString } from "@vue/server-renderer"
import { renderServerComponent } from "../src/deserialize"
import { removeCommentsFromHtml } from "./utils"

describe("serializeApp", () => {
    it("should serialize a Vue app", async () => {
        const app = createApp(ElementsOnly)
        const html = await renderToString(app)
        const serialized = await serializeApp(app)
        expect(serialized).toMatchInlineSnapshot(`
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
        
        const rebuilt = createApp({
            setup() {
                return () => renderServerComponent(serialized)
            }
        })
        const rebuiltHtml = await renderToString(rebuilt)
        expect(rebuiltHtml).toBe(html)
        expect(removeCommentsFromHtml(rebuiltHtml)).toMatchInlineSnapshot(`"<div><div>1</div><div>2</div><div>0</div></div>"`)
    })
})