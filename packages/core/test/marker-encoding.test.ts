import { describe, expect, it } from "vitest";
import { decodeMarker, encodeMarker } from "../src/runtime/shared";

const CASES: { name: string; value: unknown }[] = [
  {
    name: "comment close",
    value: [1, { text: "a-->b" }, "/x.vue"],
  },
  {
    name: "comment close variant",
    value: [1, { text: "a--!>b" }, "/x.vue"],
  },
  {
    name: "comment open",
    value: [1, { text: "a<!--b" }, "/x.vue"],
  },
  {
    name: "script close",
    value: [1, { text: "</script>" }, "/x.vue"],
  },
  {
    name: "unicode",
    value: [1, { text: "雪だるま ☃️" }, "/x.vue"],
  },
];

describe("marker encoding", () => {
  it.each(CASES)("round-trips $name without raw comment delimiters", ({ value }) => {
    const encoded = encodeMarker(value);

    expect(encoded).not.toContain("--");
    expect(encoded).not.toContain("<");
    expect(decodeMarker(encoded)).toEqual(value);
  });

  it("matches the encoded marker table", () => {
    expect(
      CASES.map(({ name, value }) => ({
        decoded: decodeMarker(encodeMarker(value)),
        encoded: encodeMarker(value),
        name,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "decoded": [
            1,
            {
              "text": "a-->b",
            },
            "/x.vue",
          ],
          "encoded": "[1,{"text":"a-\\u002D>b"},"/x.vue"]",
          "name": "comment close",
        },
        {
          "decoded": [
            1,
            {
              "text": "a--!>b",
            },
            "/x.vue",
          ],
          "encoded": "[1,{"text":"a-\\u002D!>b"},"/x.vue"]",
          "name": "comment close variant",
        },
        {
          "decoded": [
            1,
            {
              "text": "a<!--b",
            },
            "/x.vue",
          ],
          "encoded": "[1,{"text":"a\\u003C!-\\u002Db"},"/x.vue"]",
          "name": "comment open",
        },
        {
          "decoded": [
            1,
            {
              "text": "</script>",
            },
            "/x.vue",
          ],
          "encoded": "[1,{"text":"\\u003C/script>"},"/x.vue"]",
          "name": "script close",
        },
        {
          "decoded": [
            1,
            {
              "text": "雪だるま ☃️",
            },
            "/x.vue",
          ],
          "encoded": "[1,{"text":"雪だるま ☃️"},"/x.vue"]",
          "name": "unicode",
        },
      ]
    `);
  });
});
