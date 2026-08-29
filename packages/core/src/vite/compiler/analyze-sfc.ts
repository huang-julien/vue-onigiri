import { readFile } from "node:fs/promises";
import {
  type BindingMetadata,
  type SFCDescriptor,
  type SFCParseResult,
  compileScript,
  parse,
} from "@vue/compiler-sfc";
import type { ResolvedConfig } from "vite";
import type { AdditionalImport } from "../../template-compiler/codegen/context";
import { type ScriptImports, buildImportMap } from "./imports";
import { type ComponentIdGenerator, generateScopeId } from "./scope-id";
import { getCapturedSource } from "./source-capture";

/** Inputs shared by the two SFC compilation entry points (`load-virtual`, `inject-setup`). */
export interface OnigiriCompileOptions {
  config: ResolvedConfig;
  sourceMap: boolean;
  /** Overrides `config.isProduction` for the scope-id derivation. */
  isProduction?: boolean;
  componentIdGenerator?: ComponentIdGenerator;
  isCustomElement?: (tag: string) => boolean;
  additionalImports?: Map<string, AdditionalImport>;
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
  registerTarget?: (sourcePath: string) => void;
  /** Bundler resolver (`PluginContext.resolve`) so aliased and package imports resolve for `v-load-client`. */
  resolveImport?: (source: string, importer: string) => Promise<string | null | undefined>;
}

export interface ParsedSfc {
  source: string;
  descriptor: SFCDescriptor;
  errors: SFCParseResult["errors"];
}

export interface SfcAnalysis {
  bindingMetadata: BindingMetadata;
  scopeId: string | null;
  scriptImports: ScriptImports | undefined;
  importMap: Map<string, string>;
}

export async function parseSfcFile(filePath: string, sourceMap: boolean): Promise<ParsedSfc> {
  const source = getCapturedSource(filePath) ?? (await readFile(filePath, "utf8"));
  const { descriptor, errors } = parse(source, { filename: filePath, sourceMap });
  return { source, descriptor, errors };
}

/**
 * Derive what the template codegen needs from a parsed SFC: setup bindings,
 * scope id, and the `<script>` import map. Kept separate from parsing so
 * callers can bail out (parse errors, no template) before any of this runs.
 */
export async function analyzeSfc(
  parsed: ParsedSfc,
  filePath: string,
  opts: OnigiriCompileOptions,
): Promise<SfcAnalysis> {
  const { descriptor, source } = parsed;
  const { config, sourceMap, resolveImport } = opts;

  let bindingMetadata: BindingMetadata = {};
  let scriptImports: ScriptImports | undefined;
  if (descriptor.scriptSetup || descriptor.script) {
    try {
      const scriptResult = compileScript(descriptor, { id: filePath, sourceMap });
      bindingMetadata = scriptResult.bindings || {};
      scriptImports = scriptResult.imports;
    } catch (error_) {
      console.warn(`[vue-onigiri] Failed to compile script for ${filePath}:`, error_);
    }
  }

  const hasScoped = descriptor.styles.some((style) => style.scoped);
  const scopeId = hasScoped
    ? generateScopeId(
        filePath,
        source,
        config.root,
        opts.isProduction ?? config.isProduction,
        opts.componentIdGenerator,
      )
    : null;

  const importMap = await buildImportMap(
    scriptImports,
    filePath,
    config.root,
    resolveImport ? (src) => resolveImport(src, filePath) : undefined,
  );

  return { bindingMetadata, scopeId, scriptImports, importMap };
}
