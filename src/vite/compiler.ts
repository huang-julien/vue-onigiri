import type { Plugin } from "vite";
import { parse } from "@vue/compiler-sfc";
import { compileOnigiriInline } from "../template-compiler";
import MagicString from "magic-string";

// Virtual module prefix
const ONIGIRI_PREFIX = "virtual:onigiri:";
const RESOLVED_ONIGIRI_PREFIX = "\0" + ONIGIRI_PREFIX;

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
 * Vite plugin that provides onigiri serialization for Vue SFCs.
 *
 * Two modes of operation:
 *
 * 1. **virtual:onigiri/ import**: Returns just the onigiri render function
 *    ```ts
 *    import __onigiriRender from "virtual:onigiri/path/to/Component.vue"
 *    ```
 *
 * 2. **Transform hook**: Injects onigiri support into compiled SFCs
 *    - Build (inline template): Injects `if (inject(ONIGIRI_RENDER_SYMBOL))` into setup
 *    - Dev (no inline): Imports onigiri render and attaches as `__onigiriRender` property
 */
export function onigiriCompilerPlugin(
  options: OnigiriCompilerOptions = {}
): Plugin {
  const { sourceMap = true } = options;

  return {
    name: "vite:vue-onigiri-compiler",
  
    resolveId: {
      order: "pre",
      async handler(id, importer) {
        // Handle virtual:onigiri/ prefix - convert to resolved virtual module
        if (id.startsWith(ONIGIRI_PREFIX)) {
          return "\0" + id;
        }

        // If the importer is a virtual onigiri module, resolve relative to the original file
        if (importer?.startsWith(RESOLVED_ONIGIRI_PREFIX)) {
          const originalFilePath = importer.slice(RESOLVED_ONIGIRI_PREFIX.length);
          const resolved = await this.resolve(id, originalFilePath, { skipSelf: true });
          return resolved;
        }

        return null;
      }
    },

    /**
     * Load virtual:onigiri/ modules - exports only the render function
     */
    async load(id) {
       if(id.includes('devtools')) {
        return null;
      }
      // Check for resolved virtual:onigiri/ prefix
      if (!id.startsWith(RESOLVED_ONIGIRI_PREFIX)) {
        return null;
      }
      
      // Extract file path: \0virtual:onigiri/path/to/file.vue -> /path/to/file.vue
      const filePath = id.slice(RESOLVED_ONIGIRI_PREFIX.length,);
        const fs = await import("node:fs/promises");
      const source = await fs.readFile(filePath, "utf8");

      const { descriptor, errors } = parse(source, {
        filename: filePath,
        sourceMap,
      });

      if (errors.length > 0) {
        for (const error of errors) {
          this.error(error.message);
        }
        return null;
      }

      if (!descriptor.template) {
        return `export default function __onigiriRender(_ctx, _slots) { return null; }`;
      }

      // Extract imports from the script block
      let scriptImports = '';
      const scriptContent = descriptor.scriptSetup?.content || descriptor.script?.content || '';
      if (scriptContent) {
        // Match all import statements
        const importRegex = /^import\s+.+?from\s+['"].+?['"];?\s*$/gm;
        const imports = scriptContent.match(importRegex);
        if (imports) {
          // Filter and clean imports:
          // 1. Skip type-only imports (import type { ... })
          // 2. Remove inline type imports (import { type Foo, Bar })
          const cleanedImports = imports
            .filter(imp => !/^import\s+type\s+/.test(imp))
            .map(imp => {
              // Remove "type" keyword from named imports: { type Foo, Bar } -> { Bar }
              return imp.replace(/\{([^}]*)\}/g, (match, inner) => {
                const cleaned = inner
                  .split(',')
                  .map((s: string) => s.trim())
                  .filter((s: string) => !s.startsWith('type '))
                  .join(', ');
                return cleaned ? `{ ${cleaned} }` : '';
              });
            })
            // Filter out imports that became empty after removing types
            .filter(imp => !/^import\s+\{\s*\}\s+from/.test(imp) && !/^import\s+from/.test(imp));
          
          if (cleanedImports.length > 0) {
            scriptImports = cleanedImports.join('\n') + '\n';
          }
        }
      }

      const onigiriResult = compileOnigiriInline(descriptor.template.content, {
        filename: filePath,
        sourceMap,
      });

      // Build imports string from collected codegen imports
      const codegenImports = [...onigiriResult.imports].join('\n');

      // Build component declarations for resolveComponent calls
      const componentDeclarations = [...onigiriResult.components.entries()]
        .map(([tag, varName]) => `  const ${varName} = _resolveComponent("${tag}")`)
        .join('\n');

      // Export only the render function with required imports
      return {
        code: `${scriptImports}${codegenImports}
export default function __onigiriRender(_ctx, _slots) {
${componentDeclarations}
  return ${onigiriResult.expression};
}`,
        map: null,
      };
    },

    /**
     * Transform hook to inject onigiri support into compiled SFCs
     * Using order: "post" to run AFTER vue plugin
     */
    transform: {
       async handler(code, id) {
        const [filePath, query] = id.split("?");

        // Only handle .vue files
        if (!filePath.endsWith(".vue") || filePath?.startsWith(ONIGIRI_PREFIX) || filePath?.startsWith(RESOLVED_ONIGIRI_PREFIX)) {
          return null;
        }

        // For .vue file (no query) - this is the final combined output from Vue (dev mode)
        if (!query) {
          if (code.includes("export default")) {
            // Use plain virtual: prefix - Vite will handle encoding after resolveId
            const onigiriImport = `${ONIGIRI_PREFIX}${filePath}`;
             return attachAsProperty(code, filePath, onigiriImport, sourceMap);
          }
          return null;
        }

        // Handle compiled script module with type=script query (build mode with inline template)
        if (query.includes("type=script")) {
          // Check if this has inline template (build mode)
          const hasInlineTemplate = code.includes("_createElementVNode") || 
                                     code.includes("_createVNode") ||
                                     code.includes("_createBlock");

          if (hasInlineTemplate) {
            // Build mode: inject into setup - need to read template from disk
            return injectIntoSetupAsync(code, filePath, sourceMap);
          }
          // Dev mode with type=script query - skip, we handle main .vue file
          return null;
        }

        return null;
      },
    },
  };
}

/**
 * Build mode: Inject onigiri check into setup function (async - reads template from disk)
 */
async function injectIntoSetupAsync(
  code: string,
  filePath: string,
  sourceMap: boolean
): Promise<{ code: string; map: any } | null> {
  // Must have setup function
  const setupMatch = code.match(
    /setup\s*\(\s*([^,)]*?)(?:,\s*\{[^}]*\})?\s*\)\s*\{/
  );

  if (!setupMatch || setupMatch.index === undefined) {
    return null;
  }

  // Read and parse the SFC to get template
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(filePath, "utf8");
  const { descriptor } = parse(source, { filename: filePath });

  if (!descriptor.template) {
    return null;
  }

  // Compile template to onigiri expression
  const onigiriResult = compileOnigiriInline(descriptor.template.content, {
    filename: filePath,
    sourceMap,
  });

  const s = new MagicString(code);

  // Add imports
  const imports = `import { inject as __onigiri_inject } from "vue";
import { ONIGIRI_RENDER_SYMBOL as __ONIGIRI_SYMBOL } from "vue-onigiri/runtime/shared";
`;

  // Injection code
  const injectionCode = `
  if (__onigiri_inject(__ONIGIRI_SYMBOL, null)) {
    return () => ${onigiriResult.expression};
  }
`;

  const setupBodyStart = setupMatch.index + setupMatch[0].length;
  s.appendLeft(setupBodyStart, injectionCode);
  s.prepend(imports);

  return {
    code: s.toString(),
    map: sourceMap ? s.generateMap({ hires: true }) : null,
  };
}

/**
 * Dev mode: Import onigiri render and attach as component property
 */
function attachAsProperty(
  code: string,
  filePath: string,
  resolvedOnigiriId: string,
  sourceMap: boolean
): { code: string; map: any } | null {
  // Must have a default export
  if (!code.includes("export default")) {
    return null;
  }

  const s = new MagicString(code);

  // Import the onigiri render function using resolved virtual module ID
  const importStatement = `import __onigiriRender from "${resolvedOnigiriId}";\n`;

  // Handle Vue's _export_sfc pattern: export default _export_sfc(_sfc_main, [...])
  // This is the common dev mode pattern
  const exportSfcMatch = code.match(
    /export\s+default\s+(?:\/\*[^*]*\*\/\s*)?_export_sfc\s*\(\s*(_sfc_main|_sfc_component)/
  );

  if (exportSfcMatch && exportSfcMatch[1] && exportSfcMatch.index !== undefined) {
    const componentVar = exportSfcMatch[1];
    s.prepend(importStatement);
    // Attach before the export
    s.appendLeft(exportSfcMatch.index, `${componentVar}.__onigiriRender = __onigiriRender;\n`);

    return {
      code: s.toString(),
      map: sourceMap ? s.generateMap({ hires: true }) : null,
    };
  }

  // Handle: export default _sfc_main
  const varExportMatch = code.match(
    /export\s+default\s+(_sfc_main|__default__|_sfc_component)\s*;?\s*$/m
  );

  if (varExportMatch && varExportMatch[1] && varExportMatch.index !== undefined) {
    const componentVar = varExportMatch[1];
    s.prepend(importStatement);
    s.appendLeft(varExportMatch.index, `${componentVar}.__onigiriRender = __onigiriRender;\n`);

    return {
      code: s.toString(),
      map: sourceMap ? s.generateMap({ hires: true }) : null,
    };
  }

  // Handle inline export: export default /*...*/ _defineComponent({...})
  const inlineExportMatch = code.match(
    /export\s+default\s+(?:\/\*[^*]*\*\/\s*)?/
  );

  if (inlineExportMatch && inlineExportMatch.index !== undefined) {
    s.prepend(importStatement);

    const exportStart = inlineExportMatch.index;
    const exportPrefix = inlineExportMatch[0];

    s.overwrite(
      exportStart,
      exportStart + exportPrefix.length,
      "const __sfc_with_onigiri = "
    );
    s.append(`\n__sfc_with_onigiri.__onigiriRender = __onigiriRender;\nexport default __sfc_with_onigiri;`);

    return {
      code: s.toString(),
      map: sourceMap ? s.generateMap({ hires: true }) : null,
    };
  }

  return null;
}

export default onigiriCompilerPlugin;
