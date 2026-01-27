import { DirectiveBinding } from 'vue'
import { VServerComponent } from './runtime/shared'

declare module 'vue' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ObjectDirective<HostElement = any, Value = any, Modifiers extends string = string, Arg extends string = string> {
    transformOnigiri?: (node: VServerComponent, binding: DirectiveBinding<Value>) => VServerComponent
  }
}
