import type { DefineComponent } from "vue";

/**
 * Resolves a client component from a marker's chunk reference and export name.
 */
export type ImportFn = (src: string, exportName?: string) => Promise<DefineComponent>;
