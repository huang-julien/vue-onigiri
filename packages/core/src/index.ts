export * from "./vite/manifest";
export { onigiriPlugins } from "./vite/plugins";
export type { OnigiriPluginsOptions } from "./vite/plugins";
export { onigiriCompilerPlugin } from "./vite/compiler";
export type { OnigiriCompilerOptions, AdditionalImportInput } from "./vite/compiler";
export { onigiriSourceCapturePlugin } from "./vite/compiler/source-capture";
export { onigiriScanPlugin } from "./vite/scan-plugin";
export type { OnigiriScanPluginOptions } from "./vite/scan-plugin";
export type { OnigiriScanOptions } from "./vite/scan";
export { scanClientTargets } from "./vite/scan";
export { compileOnigiri, compileOnigiriInline } from "./template-compiler";
export type {
  OnigiriCompilerOptions as TemplateCompilerOptions,
  OnigiriCodegenResult,
} from "./template-compiler";
