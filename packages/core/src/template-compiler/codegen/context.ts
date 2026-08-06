import type { BindingMetadata } from "@vue/compiler-dom";

/**
 * Simple context for code generation
 * See vue's compiler codegen context
 */
export interface CodegenContext {
  code: string;
  indentLevel: number;
  push(code: string): void;
  indent(): void;
  deindent(): void;
  newline(): void;
  imports: Set<string>;
  /** Binding metadata from SFC compiler - tells us which identifiers are imported */
  bindingMetadata: BindingMetadata;
  /** Components that need resolveComponent() declarations */
  components: Map<string, string>; // tag -> variable name
  /** Local variables in scope (e.g., v-for loop variables) - should not be prefixed */
  localVars: Set<string>;
  /** SFC scoped style ID (e.g., "data-v-xxxxxxx") - added as attribute to all elements */
  scopeId: string | null;
  /**
   * Local identifier to root-relative module path from the SFC's imports;
   * matching v-load-client targets inline the path as a literal.
   */
  importMap: Map<string, string>;
  /**
   * Externally-supplied tag to import entry (Nuxt components, globals),
   * looked up under Pascal/camel/kebab casings. `export` defaults to "default".
   */
  additionalImports: Map<string, AdditionalImport>;
  isCustomElement: (tag: string) => boolean | void;
  /**
   * Optional optimization: public chunk URL to bake in place of a
   * root-relative source path. `undefined` keeps the source path, which
   * the runtime resolves via manifest glob or custom `importFn`.
   */
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
  /**
   * Called for every v-load-client target the codegen emits; the manifest
   * plugin builds its precise `import.meta.glob` from these source paths.
   */
  registerTarget?: (sourcePath: string) => void;
}

export interface AdditionalImport {
  path: string;
  export?: string;
}

export interface CodegenContextOptions {
  bindingMetadata?: BindingMetadata;
  scopeId?: string | null;
  importMap?: Map<string, string>;
  additionalImports?: Map<string, AdditionalImport>;
  isCustomElement?: (tag: string) => boolean | void;
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
  registerTarget?: (sourcePath: string) => void;
}

/**
 * Create a new codegen context for building output code
 */
export function createCodegenContext(opts: CodegenContextOptions = {}): CodegenContext {
  return {
    code: "",
    indentLevel: 0,
    imports: new Set<string>(),
    bindingMetadata: opts.bindingMetadata ?? {},
    components: new Map<string, string>(),
    localVars: new Set<string>(),
    scopeId: opts.scopeId ?? null,
    importMap: opts.importMap ?? new Map<string, string>(),
    additionalImports: opts.additionalImports ?? new Map<string, AdditionalImport>(),
    isCustomElement: opts.isCustomElement ?? (() => false),
    resolveChunkUrl: opts.resolveChunkUrl,
    registerTarget: opts.registerTarget,
    push(code: string) {
      this.code += code;
    },
    indent() {
      this.indentLevel++;
    },
    deindent() {
      this.indentLevel--;
    },
    newline() {
      this.code += "\n" + "  ".repeat(this.indentLevel);
    },
  };
}
