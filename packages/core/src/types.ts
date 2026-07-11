import type { VServerComponent } from "./runtime/shared";
import type { ObjectDirectiveBinding } from "./runtime/with-directive";

declare module "vue" {

  interface ObjectDirective<
    HostElement = any,
    Value = any,
    Modifiers extends string = string,
    Arg = any,
  > {
    /**
     * vue-onigiri serialize-time hook. Receives the resolved
     * `VServerComponent` for the element and returns a transformed copy.
     * Use this for transforms that need to rewrite children, swap tags,
     * or otherwise change the node shape — `getSSRProps` is enough when
     * you only need to contribute attributes/style/class.
     *
     * Only `value`, `arg`, and `modifiers` are populated at serialize time.
     */
    transformOnigiri?: (
      node: VServerComponent,
      binding: ObjectDirectiveBinding<Value>,
    ) => VServerComponent;
  }
}
