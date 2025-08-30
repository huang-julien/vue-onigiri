import type { DefineComponent, Directive } from "vue";
export type ImportFn = (src: string, exportName?: string) => Promise<DefineComponent>;
export const defaultImportFn: ImportFn = (src, exportName = "default") =>
  import(/* @vite-ignore */ src).then((m) => m[exportName] as DefineComponent);


export const loadClientDirective: Directive = {
    getSSRProps(binding, vnode) {
      if (binding.value !== false) {
        // @ts-ignore
        vnode._onigiriLoadClient = true;
      }
      return {};
    },
    created(_, binding, vnode) {
      if (binding.value !== false) {
        // @ts-ignore
        vnode._onigiriLoadClient = true;
      }
      return binding;
    },
  }