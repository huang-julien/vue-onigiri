import { defineComponent, h } from "vue";

export default defineComponent({

    name: "TsSlot",
    setup(props, ctx) {


        return () => h("div", null, [
            h("div", null, "TsSlot component"),
            ctx.slots.default ? ctx.slots.default() : null,
        ]);

        
    },
})