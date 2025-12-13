import type { Plugin } from "vite";
import {
  parse,
  compileScript,
  type SFCDescriptor,
  type SFCScriptBlock,
} from "@vue/compiler-sfc";
import { compileOnigiriInline } from "../template-compiler";
import { createHash } from "node:crypto";
import MagicString from "magic-string";

const ONIGIRI_QUERY = "onigiri";
const ONIGIRI_QUERY_RE = /[?&]onigiri(?:&|$)/;

/**
 * Options for the onigiri compiler plugin
 */
export interface OnigiriCompilerOptions {
  /**
   * Whether to include source maps
   * @default true
   */
  sourceMap?: boolean;
}

/**
 * Vite plugin that handles .vue?onigiri imports.
 *
 * Uses the load() hook to generate a new module that includes
 * onigiri serialization support injected into setup.
 *
 * When ONIGIRI_RENDER_SYMBOL is provided, setup returns the
 * serialized VServerComponent directly instead of VNodes.
 */
export function onigiriCompilerPlugin(
  options: OnigiriCompilerOptions = {}
): Plugin {
  const { sourceMap = true } = options;

  return {
    name: "vite:vue-onigiri-compiler",
    enforce: "pre",

    resolveId(id) {
      // Handle ?onigiri query - mark it as a virtual module
      if (ONIGIRI_QUERY_RE.test(id)) {
        const cleanId = id.replace(ONIGIRI_QUERY_RE, "").replace(/\?$/, "");
        return `\0${cleanId}?${ONIGIRI_QUERY}`;
      }
      return null;
    },

    async load(id) {
      // Only handle our virtual onigiri modules (prefixed with \0)
      if (!id.startsWith("\0") || !ONIGIRI_QUERY_RE.test(id)) {
        return null;
      }

      // Extract the real file path (remove \0 prefix and query)
      const filePath = id.slice(1).replace(ONIGIRI_QUERY_RE, "").replace(/\?$/, "");

      let source: string;
      try {
        const fs = await import("node:fs/promises");
        source = await fs.readFile(filePath, "utf8");
      } catch {
        this.error(`Failed to read file: ${filePath}`);
      }

      // Parse the SFC
      const { descriptor, errors } = parse(source, {
        filename: filePath,
        sourceMap,
      });

      if (errors.length > 0) {
        for (const error of errors) {
          this.error(error);
        }
        return null;
      }

      // Generate a scope ID for the component
      const scopeId = `data-v-${createHash("md5").update(filePath).digest("hex").slice(0, 8)}`;

      // Compile the script WITH inlineTemplate (Vue's default for production)
      let scriptResult: SFCScriptBlock | null = null;
      let scriptBindings: Record<string, any> = {};

      if (descriptor.script || descriptor.scriptSetup) {
        scriptResult = compileScript(descriptor, {
          id: scopeId,
          inlineTemplate: true, // Keep Vue's default - template inlined in setup
          sourceMap,
        });

        scriptBindings = scriptResult.bindings || {};
      }

      // Compile the template with onigiri compiler for serialization
      // This returns an inline expression, not a full function
      let onigiriExpression = "null";
      if (descriptor.template) {
        const onigiriResult = compileOnigiriInline(descriptor.template.content, {
          filename: filePath,
          sourceMap,
          bindingMetadata: scriptBindings,
        });
        onigiriExpression = onigiriResult.expression;
      }

      // Generate the final module
      const output = generateOnigiriModule({
        filePath,
        scopeId,
        scriptResult,
        onigiriExpression,
        descriptor,
        scriptBindings,
      });

      return {
        code: output,
        map: null, // TODO: generate proper source map
      };
    },
  };
}

interface GenerateModuleOptions {
  filePath: string;
  scopeId: string;
  scriptResult: SFCScriptBlock | null;
  onigiriExpression: string;
  descriptor: SFCDescriptor;
  scriptBindings: Record<string, any>;
}

/**
 * Generate the final module code with onigiri support injected into setup.
 * 
 * The key optimization here is that we inline the serialized VServerComponent
 * expression directly in setup's return, avoiding any extra function calls
 * or object allocations. The template is compiled to a literal expression
 * that produces the serialized structure directly.
 */
function generateOnigiriModule(options: GenerateModuleOptions): string {
  const { scriptResult, onigiriExpression, scriptBindings } = options;

  if (!scriptResult) {
    // No script - just export a component with inline onigiri return
    return `
import { inject } from "vue";
import { ONIGIRI_RENDER_SYMBOL } from "vue-onigiri/runtime/shared";

export default {
  setup() {
    if (inject(ONIGIRI_RENDER_SYMBOL, null)) {
      return () => ${onigiriExpression};
    }
    return () => null;
  }
};
`;
  }

  // Parse the compiled script and inject onigiri support
  const s = new MagicString(scriptResult.content);

  // Add our imports at the top
  const imports = `
import { inject as __inject } from "vue";
import { ONIGIRI_RENDER_SYMBOL as __ONIGIRI_SYMBOL } from "vue-onigiri/runtime/shared";
`;

  // Find the setup function and inject our check
  // The compiled output typically has: setup(__props, { expose: __expose }) {
  const setupMatch = scriptResult.content.match(
    /setup\s*\(\s*([^,)]*?)(?:,\s*\{[^}]*\})?\s*\)\s*\{/
  );

  if (setupMatch && setupMatch.index !== undefined) {
    const setupBodyStart = setupMatch.index + setupMatch[0].length;

    // The injection code that checks for the symbol and returns the 
    // serialized VServerComponent expression directly - no function call overhead!
    const injectionCode = `
  // Onigiri: Return serialized VNode directly (compile-time optimized)
  if (__inject(__ONIGIRI_SYMBOL, null)) {
    return () => ${onigiriExpression};
  }
`;

    // Insert the injection code at the start of setup body
    s.prependLeft(setupBodyStart, injectionCode);
  }

  // Add our imports at the very beginning
  s.prepend(imports);

  return s.toString();
}

export default onigiriCompilerPlugin;
