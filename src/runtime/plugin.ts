import type { Plugin } from "vue";
export const INJECTION_KEY = Symbol("vue-bento-injection");

export const plugin: Plugin = {
  install(app) {
    app.provide(INJECTION_KEY, new Map<string, any>());
  },
};
