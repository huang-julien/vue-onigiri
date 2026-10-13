import { defineComponent, h } from "vue";

/** `Tree.vue` as a plain render function: no `__onigiriRender`, so the VNode walk serializes it. */
export const PlainTree = defineComponent({
  props: { count: { type: Number, required: true } },
  setup(props) {
    const rows = Array.from({ length: props.count }, (_, i) => ({
      id: i,
      label: `row ${i}`,
      odd: i % 2 === 1,
    }));
    return () =>
      h(
        "ul",
        null,
        rows.map((row) =>
          h("li", { key: row.id, class: row.odd ? "odd" : "even" }, [
            h("span", null, String(row.id)),
            h("span", null, row.label),
          ]),
        ),
      );
  },
});
