
import type { PluginOption } from "vite"
import { hash } from "ohash"
import MagicString from "magic-string"
import type { ExportDefaultDeclaration } from "acorn"
import { join, normalize, relative } from "node:path"
import fs from "node:fs"
import vue from "@vitejs/plugin-vue"
import { defu } from "defu"
import type { Options } from "@vitejs/plugin-vue"
const ogReadFileSync = fs.readFileSync

// fs.readFileSync = function (path, ...args: any[]) {
//     if (typeof path === 'string' && path.startsWith('virtual:vsc:')) {
//         const file = path.replace(/virtual:vsc:/, '')
//         return ogReadFileSync(file, ...args)
//     }
//     return ogReadFileSync(path, ...args)
// }

export type VSCOptions = {
    include: string[]
    rootDir?: string
    vueClient: Options
}

const VSC_PREFIX = 'virtual:vsc:'
const VSC_PREFIX_RE = /^virtual:vsc:/
const VIRTUAL_MODULE_ID = 'virtual:components-chunk'
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID

export function vueServerComponentsPlugin(options?: Partial<VSCOptions>): { client: PluginOption, server: PluginOption } {
    const refs: { path: string, id: string }[] = []
    let assetDir: string = ''
    let isProduction = false
    let rootDir = process.cwd()

    return {
        client: [
            getPatchedClientVue(options?.vueClient), {
            name: 'vite:vue-server-components-client',
            configResolved(config) {
                assetDir = config.build.assetsDir
                isProduction = config.isProduction
                rootDir = config.root
            },
            async buildStart() {
                if (options?.include) {
                    for (const path of options.include) {
                        const resolved = await this.resolve(path)
                        if (resolved) {
                            if (isProduction) {

                                const id = this.emitFile({
                                    type: 'chunk',
                                    fileName: join(assetDir, hash(resolved) + '.mjs'),
                                    id: resolved.id,
                                    preserveSignature: 'strict',
                                })
                                refs.push({ path: resolved.id, id })
                            } else {
                                refs.push({ path: resolved.id, id: resolved.id })
                            }
                        }
                    }
                }
            },
            generateBundle(_, bundle) {
                for (const chunk of Object.values(bundle)) {
                    if (chunk.type === 'chunk') {
                        const list = refs.map(ref => ref.id)
                        if (list.includes(chunk.fileName)) {
                            chunk.isEntry = false
                            console.log(chunk.fileName)
                        }
                    }
                }
            }
        }],

        server: {
            enforce: 'pre',
            name: 'vite:vue-server-components-server',
            resolveId: {
                order: 'pre',
                async handler(id, importer) {
                    if (id === VIRTUAL_MODULE_ID) {
                        return RESOLVED_VIRTUAL_MODULE_ID
                    }
                    if (importer) {
                        if (VSC_PREFIX_RE.test(importer)) {
                            if (VSC_PREFIX_RE.test(id)) {
                                return id
                            }
                            return this.resolve(id, importer.replace(VSC_PREFIX_RE, ''), { skipSelf: true })
                        }
                    }

                    if (VSC_PREFIX_RE.test(id)) {
                        return id
                    }
                }
            },
            // @ts-ignore
            load: {
                order: 'pre',
                async handler(id) {

                    if (id === RESOLVED_VIRTUAL_MODULE_ID) {
                        return {
                            code: `export default {
        ${refs.map(({ path, id }) => {
                                return `${JSON.stringify(path)}: ${JSON.stringify(id)}`
                            }).join(',\n')}
      }`,
                            map: null,
                        }
                    }


                    const [filename, rawQuery] = id.split(`?`, 2);
                    const query = Object.fromEntries(new URLSearchParams(rawQuery));

                    if (query.vue === undefined) {
                        if (VSC_PREFIX_RE.test(id)) {
                            const file = id.replace(VSC_PREFIX_RE, '')

                            return {
                                code: fs.readFileSync(file, 'utf-8'),
                            }
                        }
                        if (filename?.endsWith('.vue')) {
                            this.emitFile({
                                type: 'chunk',
                                fileName: hash(id) + '.mjs',
                                id: VSC_PREFIX + id,
                                preserveSignature: 'strict',
                            })
                        }
                    }
                }
            },

            generateBundle(_, bundle) {
                for (const chunk of Object.values(bundle)) {
                    if (chunk.type === 'chunk') {
                        const list = refs.map(ref => ref.id)
                        if (list.includes(chunk.fileName)) {
                            chunk.isEntry = false
                        }
                    }
                }
            },

            transform: {
                order: 'post',
                handler(code, id) {
                    const ref = refs.find(ref => ref.path === id)
                    if (ref) {

                        const s = new MagicString(code)
                        const ast = this.parse(code)
                        const exportDefault = ast.body.find(node => {
                            return node.type === 'ExportDefaultDeclaration'
                        }) as ExportDefaultDeclaration & { start: number, end: number } | undefined
                        const ExportDefaultDeclaration = exportDefault?.declaration
                        if (ExportDefaultDeclaration) {
                            const { start, end } = ExportDefaultDeclaration
                            s.overwrite(start, end, `Object.assign(
                                { __chunk: "${join('/', isProduction ? normalize(this.getFileName(ref.id)) : relative(rootDir, normalize(ref.id))).replaceAll('\\', '/')}" },
                                 ${code.slice(start, end)},
                            )`)
                            return {
                                code: s.toString(),
                                map: s.generateMap({ hires: true }).toString(),
                            }
                        }
                    }
                }
            }
        },
    }
}


// fix a bug in plugin vue
function getPatchedClientVue(options?: Options) {
    const plugin = vue(defu({
        exclude: [VSC_PREFIX_RE],
        include: [/\.vue/],
    }, options))
    const oldTransform = plugin.transform;
    plugin.transform = async function (code, id, _options) {
        if (VSC_PREFIX_RE.test(id)) {
            return
        }
        // @ts-expect-error ssrUtils is not a public API
        return await oldTransform.apply(this, [code, id, _options]);
    };
    const oldLoad = plugin.load;
    plugin.load = async function (id, _options) {
        if (VSC_PREFIX_RE.test(id)) {
            return
        }
        // @ts-expect-error ssrUtils is not a public API
        return await oldLoad.apply(this, [id, _options]);
    };
    return plugin;
}