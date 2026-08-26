export * from "./vite/manifest";
export { onigiriCompilerPlugin } from "./vite/compiler";
export type { OnigiriCompilerOptions } from "./vite/compiler";
export { onigiriSourceCapturePlugin } from "./vite/compiler/source-capture";
export type { OnigiriScanOptions } from "./vite/scan";
export { scanClientTargets } from "./vite/scan";
export { compileOnigiri, compileOnigiriInline } from "./template-compiler";
export type {
  OnigiriCompilerOptions as TemplateCompilerOptions,
  OnigiriCodegenResult,
} from "./template-compiler";
