export * from "./vite/manifest";
export { onigiriCompilerPlugin } from "./vite/compiler";
export type { OnigiriCompilerOptions } from "./vite/compiler";
export { compileOnigiri, compileOnigiriInline } from "./template-compiler";
export type {
  OnigiriCompilerOptions as TemplateCompilerOptions,
  OnigiriCodegenResult,
} from "./template-compiler";
