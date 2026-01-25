import type { Plugin, Manifest } from "vite";
import MagicString from "magic-string";
import { join, normalize, relative } from "node:path";
import { readFileSync, existsSync } from "node:fs";
 import type { Options } from "@vitejs/plugin-vue";
import type { ExportDefaultDeclaration, ExportNamedDeclaration, Declaration, Identifier } from "estree";
import type { ProgramNode, RollupAstNode } from "rollup";

function normalizePath(path: string): string {
  return normalize(path).replaceAll("\\", "/");
}

export interface OnigiriChunkOptions {
  /**
   * Path to the client manifest.json file (relative to root).
   * Required for server build to know client chunk URLs.
   */
  clientManifestPath?: string;
}

/**
 * Client plugin for vue-onigiri.
 * 
 * - Attaches `__chunk: import.meta.url` and `__export` to Vue components
 * - Works with Vite's built-in manifest (`build.manifest: true`)
 * 
 * Usage:
 * ```ts
 * // vite.config.ts (client)
 * export default defineConfig({
 *   build: { manifest: true },
 *   plugins: [onigiriClientPlugin()]
 * })
 * ```
 */
export function onigiriClientPlugin(_options: OnigiriChunkOptions = {}): Plugin {
  let root = "";
  let isProduction = false;
  const emittedChunks = new Map<string, string>(); // componentId -> referenceId

  return    {
      name: "vite:vue-onigiri-client",
      
      configResolved(config) {
        root = config.root;
        isProduction = config.isProduction;
      },

      transform: {
        order: "post",
        handler(code, id) {
          // Only transform .vue files
          if (!id.endsWith(".vue")) {
            return;
          }

          // Skip query params (e.g., ?vue&type=style)
          if (id.includes("?")) {
            return;
          }

          // Skip virtual modules (handled by compiler.ts)
          if (id.includes("virtual:onigiri")) {
            return;
          }

          const s = new MagicString(code);
          const ast = this.parse(code) as RollupAstNode<ProgramNode>;
          const relativePath = normalizePath(relative(root, id));

          let chunkExpr: string;

          if (isProduction) {
            // Emit this component as its own chunk entry
            // This guarantees we know the export name ("default")
            let refId = emittedChunks.get(id);
            if (!refId) {
              refId = this.emitFile({
                type: "chunk",
                id: id,
              });
              emittedChunks.set(id, refId);
            }
            // Rollup replaces this with the actual chunk URL at build time
            chunkExpr = `import.meta.ROLLUP_FILE_URL_${refId}`;
          } else {
            // Dev mode: use relative path from root
            chunkExpr = JSON.stringify("/" + relativePath);
          }

          // Handle default export
          const defaultExport = ast.body.find(
            (node): node is ExportDefaultDeclaration => 
              node.type === "ExportDefaultDeclaration"
          );

          if (defaultExport?.declaration) {
            const { start, end } = defaultExport.declaration as unknown as RollupAstNode<Declaration>;
            const originalCode = code.slice(start, end);
            
            // __export is always "default" - we emit each component as its own entry chunk
            s.overwrite(
              start,
              end,
              `Object.assign(${originalCode}, { __chunk: ${chunkExpr}, __export: "default" })`
            );
          }

          // Handle named exports (e.g., export { _sfc_main as MyComponent })
          for (const node of ast.body) {
            if (node.type === "ExportNamedDeclaration") {
              const namedExport = node as RollupAstNode<ExportNamedDeclaration>;
              for (const specifier of namedExport.specifiers) {
                if (specifier.type === "ExportSpecifier" && specifier.exported.type === "Identifier") {
                  const localName = (specifier.local as Identifier).name;
                  
                  // Since we emit each component as its own chunk, export is always "default"
                  const exportEnd = (namedExport as unknown as RollupAstNode<ExportNamedDeclaration>).end;
                  s.appendRight(
                    exportEnd,
                    `\nObject.assign(${localName}, { __chunk: ${chunkExpr}, __export: "default" });`
                  );
                }
              }
            }
          }

          if (s.hasChanged()) {
            return {
              code: s.toString(),
              map: s.generateMap({ hires: true }),
            };
          }
        },
      },
    }

}

/**
 * Server plugin for vue-onigiri.
 * 
 * - Reads client manifest to get chunk URLs
 * - Attaches `__chunk` (client URL) to components
 * 
 * Usage:
 * ```ts
 * // vite.config.ts (server)
 * export default defineConfig({
 *   plugins: [onigiriServerPlugin({ 
 *     clientManifestPath: 'dist/client/.vite/manifest.json' 
 *   })]
 * })
 * ```
 */
export function onigiriServerPlugin(
  options: OnigiriChunkOptions = {},
 ): Plugin {
  let root = "";
  let isProduction = false;
  let clientManifest: Manifest | null = null;

  return      {
      name: "vite:vue-onigiri-server",

      configResolved(config) {
        root = config.root;
        isProduction = config.isProduction;

        // Load client manifest in production
        if (isProduction && options.clientManifestPath) {
          const manifestPath = join(root, options.clientManifestPath);
          if (existsSync(manifestPath)) {
            clientManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
          } else {
            console.warn(`[vue-onigiri] Client manifest not found at: ${manifestPath}`);
          }
        }
      },

      transform: {
        order: "post",
        handler(code, id) {
          // Only transform .vue files
          if (!id.endsWith(".vue")) {
            return;
          }

          // Skip query params
          if (id.includes("?")) {
            return;
          }

          // Skip virtual modules (handled by compiler.ts)
          if (id.includes("virtual:onigiri")) {
            return;
          }

          const s = new MagicString(code);
          const ast = this.parse(code) as RollupAstNode<ProgramNode>;
          const relativePath = normalizePath(relative(root, id));

          // Look up the client chunk URL from the manifest
          // The client emits each .vue file as its own chunk entry
          const clientChunkUrl = isProduction && clientManifest?.[relativePath]
            ? "/" + clientManifest[relativePath].file
            : "/" + relativePath;

          // Handle default export
          const defaultExport = ast.body.find(
            (node): node is ExportDefaultDeclaration =>
              node.type === "ExportDefaultDeclaration"
          );

          if (defaultExport?.declaration) {
            const { start, end } = defaultExport.declaration as unknown as RollupAstNode<Declaration>;
            const originalCode = code.slice(start, end);

            // __export is always "default" - client emits each component as its own entry chunk
            s.overwrite(
              start,
              end,
              `Object.assign(${originalCode}, { __chunk: ${JSON.stringify(clientChunkUrl)}, __export: "default" })`
            );
          }

          // Handle named exports
          for (const node of ast.body) {
            if (node.type === "ExportNamedDeclaration") {
              const namedExport = node as RollupAstNode<ExportNamedDeclaration>;
              for (const specifier of namedExport.specifiers) {
                if (specifier.type === "ExportSpecifier" && specifier.exported.type === "Identifier") {
                  const localName = (specifier.local as Identifier).name;
                  
                  // __export is always "default" since client emits separate entry chunks
                  const exportEnd = (namedExport as unknown as RollupAstNode<ExportNamedDeclaration>).end;
                  s.appendRight(
                    exportEnd,
                    `\nObject.assign(${localName}, { __chunk: ${JSON.stringify(clientChunkUrl)}, __export: "default" });`
                  );
                }
              }
            }
          }

          if (s.hasChanged()) {
            return {
              code: s.toString(),
              map: s.generateMap({ hires: true }),
            };
          }
        },
      },
    }
}

/**
 * Combined plugin factory for environments that build both client and server.
 * Uses Vite 6 Environment API for coordinated builds.
 * 
 * Usage:
 * ```ts
 * // vite.config.ts
 * const onigiri = createOnigiriPlugins();
 * 
 * export default defineConfig({
 *   environments: {
 *     client: {
 *       build: { manifest: true, outDir: 'dist/client' },
 *     },
 *     ssr: {
 *       build: { outDir: 'dist/server', ssr: true },
 *     }
 *   },
 *   plugins: [
 *     // Shared plugins that work in both environments
 *     vue(),
 *     onigiri.shared()
 *   ],
 *   builder: {
 *     async buildApp(builder) {
 *       // Build client first to generate manifest
 *       await builder.build(builder.environments.client);
 *       // Then server can read the manifest
 *       await builder.build(builder.environments.ssr);
 *     }
 *   }
 * })
 * ```
 */
export function createOnigiriPlugins(options: {
  clientOutDir?: string;
} = {}) {
  const { clientOutDir = "dist/client" } = options;
  
  let clientManifest: Manifest | null = null;
  let root = "";
  let isProduction = false;
  const emittedChunks = new Map<string, string>(); // componentId -> referenceId

  const sharedPlugin: Plugin = {
    name: "vite:vue-onigiri-shared",

    configResolved(config) {
      root = config.root;
      isProduction = config.isProduction;
      
      // Try to load manifest (available after client build)
      const manifestPath = join(root, clientOutDir, ".vite/manifest.json");
      if (existsSync(manifestPath)) {
        clientManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      }
    },

    transform: {
      order: "post",
      handler(code, id) {
        // Only transform .vue files
        if (!id.endsWith(".vue") || id.includes("?")) {
          return;
        }

        // Skip virtual modules (handled by compiler.ts)
        if (id.includes("virtual:onigiri")) {
          return;
        }

        const s = new MagicString(code);
        const ast = this.parse(code) as RollupAstNode<ProgramNode>;
        const relativePath = normalizePath(relative(root, id));

        let chunkExpr: string;

        if (clientManifest?.[relativePath]) {
          // Server build: use manifest from client build
          chunkExpr = JSON.stringify("/" + clientManifest[relativePath].file);
        } else if (isProduction) {
          // Client build in production: emit as separate chunk
          let refId = emittedChunks.get(id);
          if (!refId) {
            refId = this.emitFile({
              type: "chunk",
              id: id,
            });
            emittedChunks.set(id, refId);
          }
          chunkExpr = `import.meta.ROLLUP_FILE_URL_${refId}`;
        } else {
          // Dev mode: use source path
          chunkExpr = JSON.stringify("/" + relativePath);
        }

        // Handle default export
        const defaultExport = ast.body.find(
          (node): node is ExportDefaultDeclaration =>
            node.type === "ExportDefaultDeclaration"
        );

        if (defaultExport?.declaration) {
          const { start, end } = defaultExport.declaration as unknown as RollupAstNode<Declaration>;
          const originalCode = code.slice(start, end);

          // __export is always "default" - we emit each component as its own entry chunk
          s.overwrite(
            start,
            end,
            `Object.assign(${originalCode}, { __chunk: ${chunkExpr}, __export: "default" })`
          );
        }

        // Handle named exports
        for (const node of ast.body) {
          if (node.type === "ExportNamedDeclaration") {
            const namedExport = node as RollupAstNode<ExportNamedDeclaration>;
            for (const specifier of namedExport.specifiers) {
              if (specifier.type === "ExportSpecifier" && specifier.exported.type === "Identifier") {
                const localName = (specifier.local as Identifier).name;
                
                // __export is always "default" since we emit separate entry chunks
                const exportEnd = (namedExport as unknown as RollupAstNode<ExportNamedDeclaration>).end;
                s.appendRight(
                  exportEnd,
                  `\nObject.assign(${localName}, { __chunk: ${chunkExpr}, __export: "default" });`
                );
              }
            }
          }
        }

        if (s.hasChanged()) {
          return {
            code: s.toString(),
            map: s.generateMap({ hires: true }),
          };
        }
      },
    },
  };

  return {
    /**
     * Shared plugin that works across environments.
     * Automatically detects client vs SSR and handles manifest.
     */
    shared: () => sharedPlugin,

    /**
     * Standalone client plugin (for separate client config)
     */
    client: () => onigiriClientPlugin(
      { clientManifestPath: join(clientOutDir, ".vite/manifest.json") }
    ),

    /**
     * Standalone server plugin (for separate server config)
     */
    server: () => onigiriServerPlugin(
      { clientManifestPath: join(clientOutDir, ".vite/manifest.json") }
    ),
  };
}

// Legacy exports for backwards compatibility
export { onigiriClientPlugin as vueOnigiriClient };
export { onigiriServerPlugin as vueOnigiriServer };
export { createOnigiriPlugins as vueOnigiriPluginFactory };
