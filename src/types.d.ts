
declare module 'vue' {
  interface ObjectDirective<HostElement = any, Value = any, Modifiers extends string = string, Arg extends string = string> {
    /**
     * Transform the serialized onigiri AST node.
     */
    transformOnigiri?: (
      node: VServerComponent,
      binding: ObjectDirectiveBinding<Value>
    ) => VServerComponent;
  }
}
