import { describe, expect, it } from "vitest";
import { decodeMarker } from "../src/runtime/markers";
import { createMarkerNonce, encodeMarker } from "../src/server/markers";
import { createMarkerSet, isMarkerNonce } from "../src/shared/markers";

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

describe("marker set", () => {
  it("binds every prefix to the nonce", () => {
    expect(createMarkerSet("abc123def456ghi7")).toEqual({
      component: "o:c:abc123def456ghi7",
      componentEnd: "/o:c:abc123def456ghi7",
      teleport: "o:t:abc123def456ghi7",
    });
  });

  it("creates distinct alphanumeric nonces", () => {
    const nonce = createMarkerNonce();
    expect(nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(createMarkerNonce()).not.toBe(nonce);
  });

  it("rejects a nonce that could reshape the comment", () => {
    expect(() => createMarkerSet("a[b")).toThrow(/alphanumeric/);
    expect(() => createMarkerSet("a--b")).toThrow(/alphanumeric/);
    expect(() => createMarkerSet("")).toThrow(/alphanumeric/);
  });

  it("tells a usable nonce from anything else", () => {
    expect(isMarkerNonce(createMarkerNonce())).toBe(true);
    expect(isMarkerNonce("a".repeat(16))).toBe(true);
    expect(isMarkerNonce("a".repeat(15))).toBe(false);
    expect(isMarkerNonce("abcdefghijklmnop-")).toBe(false);
    expect(isMarkerNonce(undefined)).toBe(false);
    expect(isMarkerNonce(1234567890123456)).toBe(false);
  });

  it("rejects a nonce shorter than 16 characters", () => {
    expect(() => createMarkerSet("abc123")).toThrow(/at least 16 characters long, got 6/);
    expect(() => createMarkerSet("a".repeat(15))).toThrow(/at least 16 characters/);
    expect(createMarkerSet("a".repeat(16)).component).toBe(`o:c:${"a".repeat(16)}`);
    expect(() => createMarkerSet(createMarkerNonce())).not.toThrow();
  });
});

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
