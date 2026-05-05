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
   * Tag name → root-relative module path, supplied externally (Nuxt
   * components, user-declared globals). Looked up under PascalCase,
   * camelCase, and kebab-case variants when the SFC's own imports don't
   * resolve a `v-load-client` target.
   */
  additionalImports: Map<string, string>;
  isCustomElement: (tag: string) => boolean | void;
}

export interface CodegenContextOptions {
  bindingMetadata?: BindingMetadata;
  scopeId?: string | null;
  importMap?: Map<string, string>;
  additionalImports?: Map<string, string>;
  isCustomElement?: (tag: string) => boolean | void;
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
    additionalImports: opts.additionalImports ?? new Map<string, string>(),
    isCustomElement: opts.isCustomElement ?? (() => false),
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
