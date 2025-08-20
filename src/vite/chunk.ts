import type { Plugin } from "vite";
import { hash } from "ohash";
import MagicString from "magic-string";
import type { ExportDefaultDeclaration } from "acorn";
import { join, normalize, relative } from "node:path";
import { readFileSync } from "node:fs";
import vue from "@vitejs/plugin-vue";
import { defu } from "defu";
import type { Options } from "@vitejs/plugin-vue";
import { glob } from "node:fs/promises";

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
  serverChunks: { originalPath: string; id: string; filename?: string; clientSideChunk?: string ; serverChunkPath?: string  }[]
} {
  const { serverAssetsDir = "", clientAssetsDir = "", rootDir = "" } = options;
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
        name: "vue-onigiri:renderSlotReplace",
        transform: {
          order: "post",
          handler(code, id) {
            if (VSC_PREFIX_RE.test(id)) {
              const s = new MagicString(code);
              s.prepend(
                `import { renderSlot as cryoRenderSlot } from 'vue-onigiri/runtime/render-slot';\n`,
              );

              // replace renderSlot with vue-onigiri:renderSlot
              s.replace(/_renderSlot\(/g, "cryoRenderSlot(_ctx,");

              return {
                code: s.toString(),
                map: s.generateMap({ hires: true }).toString(),
              };
            }
          },
        },
      },
      {
        name: "vite:vue-server-components-client",
        configResolved(config) {
          if (!assetDir) {
            assetDir = config.build.assetsDir;
          }
          isProduction = config.isProduction;
          if (!rootDir) {
            options.rootDir = config.root;
          }
        },
        async buildStart() {
          console.log(clientChunks)
          const chunksToInclude = Array.isArray(options.includeClientChunks)
            ? options.includeClientChunks
            : [options.includeClientChunks || "**/*.vue"];

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
                  const emitted = this.emitFile({
                    type: "chunk",
                    id: id,
                    preserveSignature: "strict",
                  });
                  clientChunks.push({
                    originalPath: normalizePath(id),
                    id: emitted,
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
            const shouldTransform = VSC_PREFIX_RE.test(id) || clientChunks.some((chunk) => chunk.id === id);

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
                ast.body.find((node) => {
                  if (exportName === 'default') {
                    return node.type === "ExportDefaultDeclaration";
                  }
                  return node.type === "ExportNamedDeclaration" && node.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === exportName);
                })
              ]
            })

            for (const [exportName, exportNode] of exportNodes) {
              if (exportNode) {
                const { start, end } = exportNode as ExportDefaultDeclaration & { start: number; end: number };
                s.overwrite(
                  start,
                  end,
                  `Object.assign(
                                    { __chunk: "${normalizePath(join("/", isProduction ? join(clientAssetsDir, normalize(ref.id)) : relative(rootDir, normalize(ref.id))))}", __export: ${JSON.stringify(exportName)}  },
                                     ${code.slice(start, end)},
                                )`,
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
              const list = clientChunks
                .values()
                .map((ref) => ref.id)
                .toArray();
              if (list.includes(chunk.fileName)) {
                chunk.isEntry = false;
              }
            }
          }

          for (const [id, data] of clientChunks.entries()) {
            data.filename = this.getFileName(data.id);
          }
        },
      },
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
                      clientSideChunk: clientSideChunk?.filename,
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
          async handler(id, importer) {
             if (id === 'virtual:vue-onigiri') {
          return id
        }
            if (importer && VSC_PREFIX_RE.test(importer)) {
              if (VSC_PREFIX_RE.test(id)) {
                return id;
              }
              if (id.endsWith(".vue")) {
                const resolved = await this.resolve(
                  id,
                  importer.replace(VSC_PREFIX_RE, ""),
                );
                if (resolved) {
                  return VSC_PREFIX + resolved.id;
                }
              }
              return this.resolve(id, importer.replace(VSC_PREFIX_RE, ""), {
                skipSelf: true,
              });
            }

            if (VSC_PREFIX_RE.test(id)) {
              if (id.replace(VSC_PREFIX_RE, "").startsWith("./")) {
                const resolved = await this.resolve(
                  id.replace(VSC_PREFIX_RE, ""),
                  importer?.replace(VSC_PREFIX_RE, ""),
                );
                if (resolved) {
                  return VSC_PREFIX + resolved?.id;
                }
              }
              return id;
            } 
          },
        },
        load: {
          order: "pre",
          async handler(id) {
            const [filename, rawQuery] = id.split(`?`, 2);
          if (id === "virtual:vue-onigiri") {
              return `
              ${serverChunks.map((chunk, index) => `import * as i${index} from '${VSC_PREFIX + chunk.originalPath}'`).join("\n")}
              export default new Map( [
            ${serverChunks.map((chunk, index) => `[${JSON.stringify("/" + chunk.clientSideChunk)}, i${index}]`).join(",\n")}
          ] );`;
            }
            if (!rawQuery && VSC_PREFIX_RE.test(id)) {
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
              const list = serverChunks
                .values()
                .map((ref) => ref.id)
                .toArray();
              if (list.includes(chunk.fileName)) {
                chunk.isEntry = false;
                chunk.isImplicitEntry = true;
                chunk.isDynamicEntry = true

              }
            }
          }
          for(const chunk of serverChunks ) {
            chunk.serverChunkPath = this.getFileName(chunk.id);
          }
        },
 
        transform: {
          order: "post",
          handler(code, id) {
            const ref = clientChunks.find((chunk) => chunk.originalPath === id.replace(VSC_PREFIX_RE, ""));
          
            if (id && ref && VSC_PREFIX_RE.test(id)) {
              const s = new MagicString(code);
              const ast = this.parse(code);

              for(const exportName of ref.exports) {
                const exportNode = ast.body.find((node) => {
                  if (exportName === 'default') {
                    return node.type === "ExportDefaultDeclaration";
                  }
                  return node.type === "ExportNamedDeclaration" && node.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === exportName);
                }) as ExportDefaultDeclaration & { start: number; end: number } | undefined;

                if (exportNode) {
                  const { start, end } = exportNode.declaration;
                  s.overwrite(
                    start,
                    end,
                    `Object.assign(
                                    { __chunk: "${normalizePath(join("/", isProduction ? normalize(ref.filename!) : relative(rootDir, normalize(ref.id))))}", __export: ${JSON.stringify(exportName)} },
                                     ${code.slice(start, end)},
                                )`,
                  );
                }
              }

              if (s.hasChanged()) {
                return {
                  code: s.toString(),
                  map: s.generateMap({ hires: true }).toString(),
                }
              }
            }
          },
        },
      },
      {
        name: "vue-onigiri:renderSSRSlotReplace",
        transform: {
          order: "post",
          handler(code, id) {
            if (VSC_PREFIX_RE.test(id)) {
              const s = new MagicString(code);
              s.prepend(
                `import { renderSlot as cryoRenderSlot } from 'vue-onigiri/runtime/render-slot';\n`,
              );
              // replace renderSlot with vue-onigiri:renderSlot
              s.replace(/_renderSlot\(/g, "cryoRenderSlot(_ctx,");
              return {
                code: s.toString(),
                map: s.generateMap({ hires: true }).toString(),
              };
            }
          },
        },
      },
      {
        name: 'nitrofix',
        enforce: 'post',

        transform: {
          order: 'post',
          handler(code, id) {
          if(id === 'virtual:vue-onigiri') {
            return {
              code: code.replaceAll('globalThis._importMeta_.url', 'import.meta.url')
            }
          }
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
