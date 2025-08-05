import type { DefineComponent } from "vue";
export type ImportFn = (src: string, exportName?: string) => Promise<DefineComponent>;
export const defaultImportFn: ImportFn = (src, exportName = "default") =>
  import(src).then((m) => m[exportName] as DefineComponent);
