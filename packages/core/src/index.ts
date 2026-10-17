export * from "./vite/manifest";
export { onigiriPlugins } from "./vite/plugins";
export type { OnigiriPluginsOptions } from "./vite/plugins";
export { onigiriCompilerPlugin } from "./vite/compiler";
export type {
  OnigiriCompilerOptions,
  AdditionalImportInput,
  ComponentIdGenerator,
} from "./vite/compiler";
export { onigiriSourceCapturePlugin } from "./vite/compiler/source-capture";
export { ssrLoadClientTransform } from "./vite/compiler/ssr-load-client";
export { onigiriScanPlugin } from "./vite/scan-plugin";
export type { OnigiriScanPluginOptions } from "./vite/scan-plugin";
export type { OnigiriScanOptions } from "./vite/scan";
export { scanClientTargets } from "./vite/scan";
export { compileOnigiri, compileOnigiriInline } from "@vue-onigiri/compiler";
export type {
  OnigiriCompilerOptions as TemplateCompilerOptions,
  OnigiriCodegenResult,
} from "@vue-onigiri/compiler";
