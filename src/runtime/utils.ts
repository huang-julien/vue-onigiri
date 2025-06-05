import type { DefineComponent } from "vue";

export const defaultImportFn = (src: string) =>
  import(src).then((m) => m.default as DefineComponent);
