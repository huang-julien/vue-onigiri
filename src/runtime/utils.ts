import type { DefineComponent, Directive } from "vue";
export type ImportFn = (src: string, exportName?: string) => Promise<DefineComponent>;

// @ts-expect-error virtual module
const componentsImports = () => import("virtual:vue-onigiri")

export const defaultImportFn: ImportFn = (src, exportName = "default") => componentsImports().then(mod => (mod.default ?? mod)[`${src}#${exportName}`]);

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