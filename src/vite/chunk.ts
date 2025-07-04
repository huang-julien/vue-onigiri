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
import { parseAndWalk, type Identifier } from "oxc-walker";
function normalizePath(path: string): string {
  return normalize(path).replaceAll("\\", "/");
}

export type VSCOptions = {
  includeClientChunks: string[];
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
} {
  const { serverAssetsDir = "", clientAssetsDir = "" } = options;
  const refs: { path: string; id: string }[] = [];
  let assetDir: string = clientAssetsDir;
  let isProduction = false;
  let rootDir = process.cwd();

  return {
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
              parseAndWalk(code, id, {
                enter(node) {
                  if (
                    node.type === "Property" &&
                    node.value.type === "CallExpression" &&
                    node.value.callee.type === "Identifier" &&
                    node.value.callee.name === "_withCtx"
                  ) {
                    // should always be an identifier
                    const slotName = (node.key as Identifier).name
                    const callExpression = node.value;

                    s.overwrite(
                      callExpression.start,
                      callExpression.end,
                      `cryoRenderSlot(${code.slice(callExpression.start, callExpression.end)}, '${slotName}', _ctx)`,
                    );
                  }
                },
              });
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
          rootDir = config.root;
        },
        async buildStart() {
          const chunksToInclude = Array.isArray(options.includeClientChunks)
            ? options.includeClientChunks
            : [options.includeClientChunks || "**/*.vue"];

          const files = glob(chunksToInclude, {
            cwd: rootDir,
          });
          for await (const file of files) {
            const id = join(rootDir, file);
            if (isProduction) {
              const emitted = this.emitFile({
                type: "chunk",
                fileName: normalizePath(join(assetDir, hash(id) + ".mjs")),
                id: id,
                preserveSignature: "strict",
              });
              refs.push({
                path: normalizePath(id),
                id: normalizePath(this.getFileName(emitted)),
              });
            } else {
              refs.push({
                path: normalizePath(id),
                id: normalizePath(join(clientAssetsDir, relative(rootDir, id))),
              });
            }
          }
        },

        generateBundle(_, bundle) {
          for (const chunk of Object.values(bundle)) {
            if (chunk.type === "chunk") {
              const list = refs.map((ref) => ref.id);
              if (list.includes(chunk.fileName)) {
                chunk.isEntry = false;
              }
            }
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
          const chunksToInclude = Array.isArray(options.includeClientChunks)
            ? options.includeClientChunks
            : [options.includeClientChunks || "**/*.vue"];

          const files = glob(chunksToInclude, {
            cwd: rootDir,
          });
          for await (const file of files) {
            const id = join(rootDir, file);
            if (isProduction) {
              this.emitFile({
                type: "chunk",
                fileName: normalizePath(
                  join(serverAssetsDir, hash(id) + ".mjs"),
                ),
                id: id,
                preserveSignature: "strict",
              });
            }
          }
        },
        resolveId: {
          order: "pre",
          async handler(id, importer) {
            if (importer && VSC_PREFIX_RE.test(importer)) {
              if (VSC_PREFIX_RE.test(id)) {
                return id;
              }
              if (id.endsWith(".vue")) {
                const resolved = await this.resolve(id, importer);
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

            if (!rawQuery) {
              if (VSC_PREFIX_RE.test(id)) {
                const file = id.replace(VSC_PREFIX_RE, "");

                return {
                  code: readFileSync(normalizePath(normalize(file)), "utf8"),
                };
              }
              if (filename?.endsWith(".vue")) {
                const fileName = join(serverAssetsDir, hash(id) + ".mjs");
                this.emitFile({
                  type: "chunk",
                  fileName,
                  id: VSC_PREFIX + id,
                  preserveSignature: "strict",
                });
              }
            }
          },
        },

        generateBundle(_, bundle) {
          for (const chunk of Object.values(bundle)) {
            if (chunk.type === "chunk") {
              const list = refs.map((ref) => ref.id);
              if (list.includes(chunk.fileName)) {
                chunk.isEntry = false;
              }
            }
          }
        },

        transform: {
          order: "post",
          handler(code, id) {
            const ref = refs.find(
              (ref) => ref.path === id.replace(VSC_PREFIX_RE, ""),
            );

            if (ref) {
              const s = new MagicString(code);
              const ast = this.parse(code);
              const exportDefault = ast.body.find((node) => {
                return node.type === "ExportDefaultDeclaration";
              }) as
                | (ExportDefaultDeclaration & { start: number; end: number })
                | undefined;
              const ExportDefaultDeclaration = exportDefault?.declaration;
              if (ExportDefaultDeclaration) {
                const { start, end } = ExportDefaultDeclaration;
                s.overwrite(
                  start,
                  end,
                  `Object.assign(
                                    { __chunk: "${normalizePath(join("/", isProduction ? normalize(ref.id) : relative(rootDir, normalize(ref.id))))}" },
                                     ${code.slice(start, end)},
                                )`,
                );
                return {
                  code: s.toString(),
                  map: s.generateMap({ hires: true }).toString(),
                };
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
                `import { renderSSRSlot as cryoRenderSlot } from 'vue-onigiri/runtime/render-slot';\n`,
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
  plugin.transform = async function (code, id, _options) {
    if (VSC_PREFIX_RE.test(id)) {
      return;
    }
    // @ts-expect-error blabla
    return await Reflect.apply(oldTransform, this, [code, id, { ssr: false }]);
  };
  const oldLoad = plugin.load;
  plugin.load = async function (id, _options) {
    if (VSC_PREFIX_RE.test(id)) {
      return;
    }
    // @ts-expect-error blabla
    return await Reflect.apply(oldLoad, this, [id, { ssr: false }]);
  };

  return plugin;
}

function getPatchedServerVue(options?: Options): Plugin {
  const plugin = vue(
    defu(options, {
      include: [VSC_PREFIX_RE],
      exclude: [NOVSC_PREFIX_RE],
    }),
  );
  // need to force non-ssr transform to always render vnode
  const oldTransform = plugin.transform;
  plugin.transform = async function (code, id, _options) {
    if (!id.includes(".vue")) {
      return;
    }
    // @ts-expect-error blabla
    return await Reflect.apply(oldTransform, this, [code, id, { ssr: false }]);
  };
  const oldLoad = plugin.load;
  plugin.load = async function (id, _options) {
    if (!id.includes(".vue")) {
      return;
    }
    // @ts-expect-error blabla
    return await Reflect.apply(oldLoad, this, [id, { ssr: false }]);
  };

  return plugin;
}
