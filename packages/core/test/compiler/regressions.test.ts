import { describe, it, expect } from "vite-plus/test";
import { compileOnigiri } from "../../src/template-compiler";
import { expectParses } from "./utils";

describe("onigiri compiler", () => {
  describe("codegen syntax validity and scoping regressions", () => {
    it("camelizes kebab-case v-on event names", () => {
      const result = compileOnigiri(`<MyComp @my-event="fn" />`);
      expectParses(result.code);
      expect(result.code).toContain('"onMyEvent": _ctx.fn');
      expect(result.code).not.toContain("onMy-event");
    });

    it("compiles v-on event modifiers through withModifiers", () => {
      const result = compileOnigiri(`<button @click.stop.prevent="go">x</button>`);
      expectParses(result.code);
      expect(result.code).toContain('import { withModifiers as _withModifiers } from "vue"');
      expect(result.code).toContain('"onClick": _withModifiers(_ctx.go, ["stop","prevent"])');
    });

    it("compiles key modifiers through withKeys on keyboard events only", () => {
      const keyboard = compileOnigiri(`<input @keyup.enter="submit" />`);
      expectParses(keyboard.code);
      expect(keyboard.code).toContain('"onKeyup": _withKeys(_ctx.submit, ["enter"])');

      const mouse = compileOnigiri(`<button @click.enter="go">x</button>`);
      expectParses(mouse.code);
      expect(mouse.code).toContain('"onClick": _ctx.go');
      expect(mouse.code).not.toContain("_withKeys");
    });

    it("event option modifiers become handler-key suffixes", () => {
      const result = compileOnigiri(
        `<div @scroll.passive="onScroll" @click.capture.once="go">x</div>`,
      );
      expectParses(result.code);
      expect(result.code).toContain('"onScrollPassive": _ctx.onScroll');
      expect(result.code).toContain('"onClickCaptureOnce": _ctx.go');
    });

    it("stacks withKeys around withModifiers for combined modifiers", () => {
      const result = compileOnigiri(`<input @keydown.ctrl.enter="submit" />`);
      expectParses(result.code);
      expect(result.code).toContain(
        '"onKeydown": _withKeys(_withModifiers(_ctx.submit, ["ctrl"]), ["enter"])',
      );
    });

    it("resolves .left/.right as mouse modifiers on mouse events and keys on keyboard events", () => {
      const mouse = compileOnigiri(`<button @click.left="go">x</button>`);
      expectParses(mouse.code);
      expect(mouse.code).toContain('_withModifiers(_ctx.go, ["left"])');

      const keyboard = compileOnigiri(`<input @keyup.left="go" />`);
      expectParses(keyboard.code);
      expect(keyboard.code).toContain('_withKeys(_ctx.go, ["left"])');
    });

    it("Suspense #fallback is carried as the third tuple element, not flattened into content", () => {
      const result = compileOnigiri(
        `<Suspense><template #default><Content /></template><template #fallback><p>loading</p></template></Suspense>`,
      );
      expectParses(result.code);
      expect(result.code).toMatch(
        /return \[4, \[.+\], \[\[0, "p", undefined, \[\[2, "loading"\]\]\]\]\];/,
      );
    });

    it("Suspense without a fallback keeps the two-element tuple", () => {
      const result = compileOnigiri(`<Suspense><Content /></Suspense>`);
      expectParses(result.code);
      expect(result.code).toMatch(/return \[4, \[.+\]\];/);
      expect(result.code).not.toContain("loading");
    });

    it("comment-only v-if branch emits valid JS (empty fragment)", () => {
      const result = compileOnigiri(`<template v-if="show"><!-- todo --></template>`);
      expectParses(result.code);
      expect(result.code).toContain("? [3, []] :");
    });

    it("comment-only v-for body emits valid JS (empty fragment)", () => {
      const result = compileOnigiri(
        `<template v-for="i in list" :key="i"><!-- todo --></template>`,
      );
      expectParses(result.code);
      expect(result.code).toContain("=> [3, []]");
    });

    it("comment between element children leaves no sparse-array hole", () => {
      const result = compileOnigiri(`<div><!-- c --><span>a</span></div>`);
      expectParses(result.code);
      expect(result.code).not.toContain("[, ");
      expect(result.code).toContain('[[0, "span", undefined, [[2, "a"]]]]');
    });

    it("comment-only template emits null", () => {
      const result = compileOnigiri(`<!-- nothing to render -->`);
      expectParses(result.code);
      expect(result.code).toContain("return null;");
    });

    it("root comment next to an element leaves no sparse-array hole", () => {
      const result = compileOnigiri(`<!-- c --><div>x</div>`);
      expectParses(result.code);
      expect(result.code).not.toContain("[, ");
    });

    it("destructured v-for bindings stay un-prefixed", () => {
      const result = compileOnigiri(`<li v-for="{ id, name } in items" :key="id">{{ name }}</li>`);
      expectParses(result.code);
      expect(result.code).toContain("_renderList(_ctx.items, ({ id, name }) =>");
      expect(result.code).toContain('{"key": id}');
      expect(result.code).toContain("[2, _toDisplayString(name)]");
      expect(result.code).not.toContain("_ctx.id");
      expect(result.code).not.toContain("_ctx.name");
    });

    it("wraps interpolations with toDisplayString", () => {
      const result = compileOnigiri(`<span>{{ maybeNull }}</span>`);
      expectParses(result.code);
      expect(result.code).toContain('import { toDisplayString as _toDisplayString } from "vue"');
      expect(result.code).toContain("[2, _toDisplayString(_ctx.maybeNull)]");

      const compound = compileOnigiri(`<span>{{ a }} - {{ b }}</span>`);
      expectParses(compound.code);
      expect(compound.code).toContain("_toDisplayString(_ctx.a)");
      expect(compound.code).toContain("_toDisplayString(_ctx.b)");
    });

    it("expands v-model on components to modelValue + onUpdate:modelValue", () => {
      const result = compileOnigiri(`<MyComp v-model="foo" />`);
      expectParses(result.code);
      expect(result.code).toContain('"modelValue": _ctx.foo');
      expect(result.code).toContain('"onUpdate:modelValue": $event => ((_ctx.foo) = $event)');
    });

    it("expands named and modified v-model on components", () => {
      const result = compileOnigiri(`<MyComp v-model:title.trim="t" />`);
      expectParses(result.code);
      expect(result.code).toContain('"title": _ctx.t');
      expect(result.code).toContain('"onUpdate:title": $event => ((_ctx.t) = $event)');
      expect(result.code).toContain('"titleModifiers": {"trim": true}');
    });

    it("keeps v-model on plain elements on the runtime-directive path", () => {
      const result = compileOnigiri(`<input v-model="foo" />`);
      expectParses(result.code);
      expect(result.code).not.toContain("modelValue");
    });

    it("merges static and dynamic class/style instead of emitting duplicate keys", () => {
      const result = compileOnigiri(
        `<div class="a" :class="dyn" style="color:red" :style="s">x</div>`,
      );
      expectParses(result.code);
      expect(result.code).toContain('"class": _normalizeClass(["a", _ctx.dyn])');
      expect(result.code).toContain('"style": _normalizeStyle(["color:red", _ctx.s])');
      expect(result.code).toContain('import { normalizeClass as _normalizeClass } from "vue"');
      expect((result.code.match(/"class":/g) || []).length).toBe(1);
      expect((result.code.match(/"style":/g) || []).length).toBe(1);
    });

    it("leaves lone static or lone dynamic class untouched", () => {
      const staticOnly = compileOnigiri(`<div class="a">x</div>`);
      expectParses(staticOnly.code);
      expect(staticOnly.code).toContain('"class": "a"');
      expect(staticOnly.code).not.toContain("_normalizeClass");

      const dynamicOnly = compileOnigiri(`<div :class="dyn">x</div>`);
      expectParses(dynamicOnly.code);
      expect(dynamicOnly.code).toContain('"class": _ctx.dyn');
      expect(dynamicOnly.code).not.toContain("_normalizeClass");
    });

    it("v-for over non-array sources compiles through renderList", () => {
      const obj = compileOnigiri(`<li v-for="(v, k) in obj" :key="k">{{ v }}</li>`);
      expectParses(obj.code);
      expect(obj.code).toContain('import { renderList as _renderList } from "vue"');
      expect(obj.code).toContain("_renderList(_ctx.obj, (v, k) =>");

      const num = compileOnigiri(`<i v-for="n in count" :key="n">{{ n }}</i>`);
      expectParses(num.code);
      expect(num.code).toContain("_renderList(_ctx.count, (n) =>");

      const range = compileOnigiri(`<i v-for="n in 3" :key="n">{{ n }}</i>`);
      expectParses(range.code);
      expect(range.code).toContain("_renderList(3, (n) =>");
    });

    it("nested v-for shadowing the same binding keeps the outer var local afterwards", () => {
      const result = compileOnigiri(`
        <div v-for="item in items" :key="item.id">
          <span v-for="item in item.children" :key="item">{{ item }}</span>
          <em>{{ item.label }}</em>
        </div>
      `);
      expectParses(result.code);
      expect(result.code).toContain("item.label");
      expect(result.code).not.toContain("_ctx.item.label");
    });

    it("scoped slot destructured params stay un-prefixed in the slot body", () => {
      const result = compileOnigiri(
        `<MyComp><template #default="{ item }">{{ item.name }}</template></MyComp>`,
      );
      expectParses(result.code);
      expect(result.code).toContain("({ item }) => [[2, _toDisplayString(item.name)]]");
      expect(result.code).not.toContain("_ctx.item");
    });

    it("scoped slot plain param stays un-prefixed in the slot body", () => {
      const result = compileOnigiri(
        `<MyComp><template #default="slotProps">{{ slotProps.name }}</template></MyComp>`,
      );
      expectParses(result.code);
      expect(result.code).toContain("(slotProps) => [[2, _toDisplayString(slotProps.name)]]");
      expect(result.code).not.toContain("_ctx.slotProps");
    });

    it("custom directive modifiers serialize by name", () => {
      const result = compileOnigiri(`<div v-focus.lazy.deep>x</div>`);
      expectParses(result.code);
      expect(result.code).toContain('{"lazy": true, "deep": true}');
      expect(result.code).not.toContain("[object Object]");
    });

    it("dynamic attribute names emit a computed key", () => {
      const result = compileOnigiri(`<div :[attrName]="attrValue">x</div>`);
      expectParses(result.code);
      expect(result.code).toContain("{[_ctx.attrName]: _ctx.attrValue}");
    });

    it("dynamic event names emit a computed handler key", () => {
      const result = compileOnigiri(`<div @[eventName]="handler">x</div>`);
      expectParses(result.code);
      expect(result.code).toContain("[_toHandlerKey(_ctx.eventName)]: _ctx.handler");
      expect(result.code).toContain('import { toHandlerKey as _toHandlerKey } from "vue"');
    });
  });
});
