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
}

/**
 * Create a new codegen context for building output code
 */
export function createCodegenContext(): CodegenContext {
  return {
    code: '',
    indentLevel: 0,
    imports: new Set<string>(),
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
