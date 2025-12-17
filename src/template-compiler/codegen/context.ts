import type { BindingMetadata } from "@vue/compiler-dom";

/**
 * Simple context for code generation
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
}

/**
 * Create a new codegen context for building output code
 */
export function createCodegenContext(bindingMetadata: BindingMetadata = {}): CodegenContext {
  return {
    code: '',
    indentLevel: 0,
    imports: new Set<string>(),
    bindingMetadata,
    components: new Map<string, string>(),
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
      this.code += '\n' + '  '.repeat(this.indentLevel);
    }
  };
}
