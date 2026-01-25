declare module "virtual:vsc:*" {
  import type { Component } from "vue";
  const component: Component;
  export default component;
}

/**
 * Vue's compile-time dev flag.
 */
declare const __DEV__: boolean;
