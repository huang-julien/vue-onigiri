import type { Plugin } from "vite";
import { hash } from "ohash";
import MagicString from "magic-string";
 import { join, normalize, relative } from "node:path";
import { readFileSync } from "node:fs";
import vue from "@vitejs/plugin-vue";
import { defu } from "defu";
import type { Options } from "@vitejs/plugin-vue";
import { glob } from "node:fs/promises";
import type { Directive } from "vue";
import type { ExportNamedDeclaration, ExportDefaultDeclaration, Declaration } from "estree";
import type { AstNodeLocation, ProgramNode, RollupAstNode } from "rollup";

function normalizePath(path: string): string {
  return normalize(path).replaceAll("\\", "/");
}

export type VSCOptions = {
  includeClientChunks: (string | { path: string, export: string })[];
  /**
   * root directory from which to resolve the files.
   * @default {string} root of the project
   */
  rootDir?: string;
  /**
   * If the server plugin is used, this options will be passed to the modified vue plugin to generate component chunks using vnodes instead of string buffers.
   */
  vueServerOptions?: Options;
  /**
   * @default {string} build asset dir to store server chunks.
   */
  serverAssetsDir?: string;
  /**
   * @default {string} build asset dir to store client chunks. Fallbacks to `build.assetsDir` if not provided.
   */
  clientAssetsDir?: string;
};

const VSC_PREFIX = "virtual:vsc:";
const VSC_PREFIX_RE = /^(\/?@id\/)?virtual:vsc:/;
const NOVSC_PREFIX_RE = /^(\/?@id\/)?(?!virtual:vsc:)/;

export function vueOnigiriPluginFactory(options: Partial<VSCOptions> = {}): {
  client: (opts?: Options) => Plugin[];
  server: (opts?: Options) => Plugin[];
  clientChunks: { originalPath: string; id: string; filename?: string; }[]
  serverChunks: { originalPath: string; id: string; filename?: string; clientSideChunk?: string; serverChunkPath?: string }[]
} {
  let { serverAssetsDir = "", clientAssetsDir = "", rootDir = "" } = options;
  const clientChunks: { originalPath: string; id: string; filename?: string, exports: string[] }[] = [];
  const serverChunks: { originalPath: string; id: string; filename?: string, exports: string[], clientSideChunk?: string, serverChunkPath?: string }[] = [];
  let assetDir: string = clientAssetsDir;
  let isProduction = false;
  return {
    clientChunks: clientChunks,
    serverChunks,
    client: (opts) => [
      vue(opts),
      {
        name: "vite:vue-server-components-client",
        configResolved(config) {
          if (!assetDir) {
            assetDir = config.build.assetsDir;
          }
          isProduction = config.isProduction;
          if (!rootDir) {
            rootDir = config.root;
          }
        },
        async buildStart() {
          const chunksToInclude = Array.isArray(options.includeClientChunks) ? options.includeClientChunks : [options.includeClientChunks || "**/*.vue"];

          await Promise.all(chunksToInclude.map(async (file) => {
            const path = typeof file === "string" ? file : file.path;
            const exportName = typeof file === "string" ? 'default' : file.export;
            const files = glob(path, {
              cwd: rootDir,
            });
            for await (const file of files) {
              const id = join(rootDir, file);

              const info = clientChunks.find((chunk) => chunk.originalPath === normalizePath(id));
              if (info) {
                info.exports.push(exportName);
              } else {
                if (isProduction) {
             
                    clientChunks.push({
                      originalPath: normalizePath(id),
                      id: hash(id),
                      exports: [exportName],
                    });
                } else {
                  clientChunks.push({
                    originalPath: normalizePath(id),
                    id: normalizePath(join(clientAssetsDir, relative(rootDir, id))),
                    exports: [exportName],
                  });
                }
              }
            }
          }))
        },
        transform: {
          order: 'post',
          async handler(code, id) {
            const shouldTransform = VSC_PREFIX_RE.test(id) || clientChunks.some((chunk) => chunk.originalPath === id);
            if (!shouldTransform) {
              return;
            }

            const ref = clientChunks.find(info => info.originalPath === normalizePath(id) || info.id === id);
            if (!ref) {
              return;
            }

            const s = new MagicString(code);
            const ast = this.parse(code);

           const exportNodes = ref.exports.map((exportName) => {
              return [
                exportName,
                ast.body.find((node): node is ExportDefaultDeclaration | ExportNamedDeclaration => {
                  if (exportName === "default") {
                    return node.type === "ExportDefaultDeclaration";
                  }
                  return node.type === "ExportNamedDeclaration" && node.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === exportName);
                })
              ] as const;
            });
            for (const [exportName, exportNode] of exportNodes) {
              if (exportNode && exportNode.declaration) {
                const { start, end } = exportNode.declaration as unknown as AstNodeLocation;
                s.overwrite(
                  start,
                  end,
                  `Object.assign(${code.slice(start, end)},
                                    { __chunk: "${normalizePath(join("/", isProduction ? ref.id : relative(rootDir, normalize(ref.id))))}", __export: ${JSON.stringify(exportName)}  },
                                )`
                );
              }
            }
            if (s.hasChanged()) {
              return {
                code: s.toString(),
                map: s.generateMap({ hires: true }).toString(),
              };
            }
          }
        },


        generateBundle(_, bundle) {
          for (const chunk of Object.values(bundle)) {
            if (chunk.type === "chunk") {
              const list = clientChunks.values().map((ref) => ref.id).toArray();
              if (list.includes(chunk.fileName)) {
                chunk.isEntry = false;
              }
            }
          } 
        }
      },
      {
        name: 'load:vue-onigiri',
        resolveId(id, importer, opts) {
          if (VSC_PREFIX_RE.test(id) ) {
            return this.resolve(id.replace(VSC_PREFIX, ""), importer?.replace(VSC_PREFIX_RE, ""), opts);
          }
          if(id === 'virtual:vue-onigiri') {
            return id
          }
        },
        load(id) {          
            if(id === 'virtual:vue-onigiri') { 
              return `
              import { defineAsyncComponent } from "vue";
              export default {
                ${clientChunks.map(chunk =>
                  chunk.exports.map(exportName =>
                    `"${normalizePath(join("/", isProduction ? normalize(chunk.id) : relative(rootDir, normalize(chunk.id))))}#${exportName}": defineAsyncComponent(() => import("${chunk.originalPath}").then(m => m.${exportName}))`
                  ).join(",\n")
                ).join(",\n")}
              }
              `
            }
        },
      }
    ],

    server: (opts) => [
      getVuePlugin(opts),
      getPatchedServerVue(options?.vueServerOptions) as Plugin,
      {
        enforce: "pre",
        name: "vite:vue-server-components-server",
        async buildStart() {
          if (!isProduction) {
            return
          }


          if (options.includeClientChunks) {

            await Promise.all((Array.isArray(options.includeClientChunks) ? options.includeClientChunks : [options.includeClientChunks]).map(async (file) => {
              const path = typeof file === "string" ? file : file.path;
              const exportName = typeof file === "string" ? 'default' : file.export;
              const files = glob(path, {
                cwd: rootDir,
              });

              for await (const file of files) {
                const id = join(rootDir, file);
                const info = serverChunks.find((chunk) => chunk.originalPath === normalizePath(id));
                if (info) {
                  info.exports.push(exportName);
                } else {
                  const clientSideChunk = clientChunks.find((chunk) => chunk.originalPath === normalizePath(id));

                  if (isProduction) {
                    const emitted = this.emitFile({
                      type: "chunk",
                      id: VSC_PREFIX + id,
                      preserveSignature: "strict",
                    });
                    serverChunks.push({
                      originalPath: normalizePath(id),
                      id: emitted,
                      exports: [exportName],
                      clientSideChunk: clientSideChunk?.filename
                    });
                  } else {
                    serverChunks.push({
                      originalPath: normalizePath(id),
                      id: normalizePath(join(clientAssetsDir, relative(rootDir, id))),
                      exports: [exportName],
                      clientSideChunk: clientSideChunk?.filename
                    });
                  }
                }
              }
            }))
          }

          this.emitFile({
            type: 'chunk',
            fileName: 'vue-onigiri.mjs',
            id: 'virtual:vue-onigiri',
            preserveSignature: 'strict',
          })

        },
        resolveId: {
          order: "pre",
          async handler(id, importer, opts) {
              if (id === "virtual:vue-onigiri") {
              return id;
            }
            if (importer && VSC_PREFIX_RE.test(importer)) {
              if (VSC_PREFIX_RE.test(id)) {
                return id;
              }
              if (id.endsWith(".vue")) {
                const resolved = await this.resolve(
                  id,
                  importer.replace(VSC_PREFIX_RE, ""),
                  opts
                );
                if (resolved) {
                  return VSC_PREFIX + resolved.id;
                }
              }
              return this.resolve(id, importer.replace(VSC_PREFIX_RE, ""), opts);
            }
            if (id.endsWith(".ts") || id.endsWith(".tsx") || id.endsWith(".js") || id.endsWith(".jsx")) {
              return this.resolve(id.replace(VSC_PREFIX_RE, ""), importer?.replace(VSC_PREFIX_RE, ""), opts);
            }
            if (VSC_PREFIX_RE.test(id)) {
              if (id.replace(VSC_PREFIX_RE, "").startsWith("./")) {
                const resolved = await this.resolve(
                  id.replace(VSC_PREFIX_RE, ""),
                  importer?.replace(VSC_PREFIX_RE, ""),
                  opts
                );
                if (resolved) {
                  return VSC_PREFIX + resolved?.id;
                }
              }
              return id;
            }
          }
        },
        load: {
          order: "pre",
          async handler(id) {
            const [filename, rawQuery] = id.split(`?`, 2);
            if (!rawQuery && VSC_PREFIX_RE.test(id) && id.endsWith('.vue')) {
              const file = id.replace(VSC_PREFIX_RE, "");

              return {
                code: readFileSync(normalizePath(normalize(file)), "utf8"),
              };
            }
          },
        },

        
        generateBundle(output, bundle) {
          for (const chunk of Object.values(bundle)) {
            if (chunk.type === "chunk") {
              const list = serverChunks.values().map((ref) => ref.id).toArray();
              if (list.includes(chunk.fileName)) {
                chunk.isEntry = false;
                chunk.isImplicitEntry = false;
                chunk.isDynamicEntry = false;
              }
            }
          } 
        },

        transform: {
          order: "post",
          handler(code, id) {
               const ref = clientChunks.find((chunk) => chunk.originalPath === id.replace(VSC_PREFIX_RE, ""));

            if (id && ref) {
              const s = new MagicString(code);
              const ast = this.parse(code) as RollupAstNode<ProgramNode>;
              for (const exportName of ref.exports) {
                const exportNode = ast.body.find((node): node is (ExportNamedDeclaration | ExportDefaultDeclaration) => {
                  if (exportName === "default") {
                    return node.type === "ExportDefaultDeclaration";
                  }
                  return node.type === "ExportNamedDeclaration" && node.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === exportName);
                });
                if (exportNode) {
                                  if (exportNode.declaration) {
                
                                  const { start, end } = exportNode.declaration as unknown as RollupAstNode<Declaration>; 
                                    s.overwrite(
                                      start,
                                      end,
                                      `Object.assign( ${code.slice(start, end)},
                                                      { __chunk: "${normalizePath(join("/", isProduction ? ref.id : relative(rootDir, normalize(id))))}", __export: ${JSON.stringify(exportName)} },
                                                      
                                                  )`,
                                    );
                                  } else { 
                                    // todo
                                  }
                                }
              }
              if (s.hasChanged()) {
                return {
                  code: s.toString(),
                  map: s.generateMap({ hires: true }).toString()
                };
              }
            }
          },
        },
      },
       
      {
        name: 'vue:onigiri:loadvirtual',
        load(id) {
          if (id === "virtual:vue-onigiri") {
            return `
              ${serverChunks.map((chunk, index) => `import * as i${index} from '${VSC_PREFIX + chunk.originalPath}'`).join("\n")}
              export default new Map( [
            ${serverChunks.map((chunk, index) => `[${JSON.stringify("/" + chunk.clientSideChunk)}, i${index}]`).join(",\n")}
          ] );`;
          }
        }
      }
    ],
  };
}

function getVuePlugin(options?: Options) {
  const plugin = vue(
    defu(
      {
        exclude: [VSC_PREFIX_RE],
      },
      options,
    ),
  );
  // need to force non-ssr transform to always render vnode
  const oldTransform = plugin.transform;
  plugin.transform = async function (code, id, options) {
    if (VSC_PREFIX_RE.test(id)) {
      return;
    }
    // @ts-expect-error blabla
    return await Reflect.apply(oldTransform, this, [code, id, options]);
  };
  const oldLoad = plugin.load;
  plugin.load = async function (id, options) {
    if (VSC_PREFIX_RE.test(id)) {
      return;
    }
    // @ts-expect-error blabla
    return await Reflect.apply(oldLoad, this, [id, options]);
  };

  return plugin;
}

function getPatchedServerVue(options?: Options): Plugin {
  const plugin = vue(defu(options));
  // need to force non-ssr transform to always render vnode
  const oldTransform = plugin.transform;
  plugin.transform = async function (code, id, _options) {
    if (!VSC_PREFIX_RE.test(id)) {
      return;
    }
    // @ts-expect-error blabla
    return await Reflect.apply(oldTransform, this, [code, id, { ssr: false }]);
  };
  const oldLoad = plugin.load;
  plugin.load = async function (id, _options) {
    if (!VSC_PREFIX_RE.test(id)) {
      return;
    }
    // @ts-expect-error blabla
    return await Reflect.apply(oldLoad, this, [id, { ssr: false }]);
  };

  return plugin;
}
