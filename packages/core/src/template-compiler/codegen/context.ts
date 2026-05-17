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
   * Local identifier → root-relative module path (from the SFC's `import`
   * statements). When present for a `v-load-client` target, the compiler
   * inlines the path as a literal string.
   */
  importMap: Map<string, string>;
  /**
   * Tag name → import entry, supplied externally (Nuxt components,
   * user-declared globals). Looked up under PascalCase, camelCase, and
   * kebab-case variants when the SFC's own imports don't resolve.
   * `export` defaults to `"default"`.
   */
  additionalImports: Map<string, AdditionalImport>;
  isCustomElement: (tag: string) => boolean | void;
  /**
   * Optional build-time hook: takes the source path the compiler would
   * stamp into the AST (e.g. `/components/Counter.vue`) and returns the
   * public chunk URL (e.g. `/_nuxt/Counter-XXX.js`) the client should
   * load instead. Returning `undefined` keeps the source path. Wired up
   * by hosts that have a client manifest at SSR-build time so the
   * island response doesn't carry source paths to the browser. Without
   * this, the AST emits the source path and the runtime loader falls
   * back to `import.meta.glob` keyed by source path.
   */
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
  /**
   * Called for every `v-load-client` target the codegen emits. The
   * manifest plugin uses this to build a precise `import.meta.glob`
   * covering exactly the files the runtime loader can be asked for,
   * instead of a broad `/**\/*.vue` pattern. Receives the source path
   * the compiler resolved from the SFC's imports.
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
