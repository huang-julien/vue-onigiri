
import type { PluginOption } from "vite"
import { hash } from "ohash"
import MagicString from "magic-string"
import type { ExportDefaultDeclaration } from "acorn"
import { join, normalize, relative } from "node:path"
import { readFileSync } from "node:fs"
import vue from "@vitejs/plugin-vue"
import { defu } from "defu"
import type { Options } from "@vitejs/plugin-vue"
import { createFilter, type FilterPattern } from "vite"
export type VSCOptions = {
    clientChunks?: {
        /**
         * @default /\.vue$/
         */
        include?: FilterPattern
        exclude?: FilterPattern
    }
    rootDir?: string
    vueClient?: Options
    vueServerOptions?: Options
    /**
     * @default your dist dir
     */
    serverVscDir?: string
    /**
     * @default your asset dir
     */
    clientVscDir?: string
}

const VSC_PREFIX = 'virtual:vsc:'
const VSC_PREFIX_RE = /^virtual:vsc:/
const NOVSC_PREFIX_RE = /^(?!virtual:vsc:)/

export function vueServerComponentsPlugin(options: Partial<VSCOptions> = {}): {     client: (opts?: Options) => PluginOption, server: (opts?: Options) => PluginOption } {
    const refs: { path: string, id: string }[] = []
    let assetDir: string = ''
    let isProduction = false
    let rootDir = process.cwd()
    const { serverVscDir = '', clientVscDir = '' } = options

    const filter = createFilter(options.clientChunks?.include ?? /.vue$/, options.clientChunks?.exclude)
    const serverComprefs = new Map<string, string>()
    return {
        client: (opts) => [vue(opts), {
            name: 'vite:vue-server-components-client',
            configResolved(config) {
                assetDir = config.build.assetsDir
                isProduction = config.isProduction
                rootDir = config.root
            },
            load: {
                async handler(id) {
                    if (!filter(id)) {
                        return
                    }
                    if (isProduction) {
                        const emitted = this.emitFile({
                            type: 'chunk',
                            fileName: join(clientVscDir || assetDir, hash(id) + '.mjs'),
                            id: id,
                            preserveSignature: 'strict',
                        })
                        refs.push({ path: id, id: emitted })
                    } else {
                        refs.push({ path: id, id })
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
            }
        }],

        server: (opts) => [
            getVuePlugin(opts),
            getPatchedServerVue(options?.vueServerOptions),
            {
                enforce: 'pre',
                name: 'vite:vue-server-components-server',
                resolveId: {
                    order: 'pre',
                    async handler(id, importer) {
                        if (importer && VSC_PREFIX_RE.test(importer)) {
                            if (VSC_PREFIX_RE.test(id)) {
                                return id
                            }
                            if (id.endsWith('.vue')) {
                                const resolved = (await this.resolve(id, importer.replace(VSC_PREFIX_RE, '')))
                                if (resolved) {
                                    console.log('resolved', id, importer, resolved.id)
                                    return VSC_PREFIX + resolved.id
                                }
                            }
                            return this.resolve(id, importer.replace(VSC_PREFIX_RE, ''), { skipSelf: true })
                        }

                        if (VSC_PREFIX_RE.test(id)) {
                            if (id.replace(VSC_PREFIX_RE, '').startsWith('./')) {
                                const resolved = await this.resolve(id.replace(VSC_PREFIX_RE, ''));
                                if (resolved) {
                                    return VSC_PREFIX + resolved?.id
                                }
                            }
                            return id
                        }
                    }
                },
                load: {
                    order: 'pre',
                    async handler(id) {
                        const [filename, rawQuery] = id.split(`?`, 2);

                        if (!rawQuery) {
                            if (VSC_PREFIX_RE.test(id)) {
                                const file = id.replace(VSC_PREFIX_RE, '')

                                return {
                                    code: readFileSync(normalize(file).replaceAll('\\', '/'), 'utf8'),
                                }
                            }
                            if (filename?.endsWith('.vue')) {
                                const fileName = serverVscDir + hash(id) + '.mjs'
                                this.emitFile({
                                    type: 'chunk',
                                    fileName,
                                    id: VSC_PREFIX + id,
                                    preserveSignature: 'strict',
                                })

                                serverComprefs.set(id, fileName)
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
                        const ref = refs.find(ref => ref.path === id.replace(VSC_PREFIX_RE, ''))
                        
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
                                    { __vnodeVersion: ${JSON.stringify(serverComprefs.get(id)!)}} ,
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
            {
                name: 'vue-cryo:renderSlotReplace', 
                transform: {
                    order: 'post',
                    handler(code, id) {
                        if (VSC_PREFIX_RE.test(id)) {
                            
                            const s = new MagicString(code)
                            s.prepend(`import { renderSlot as cryoRenderSlot } from 'vue-cryo/runtime/render-slot';\n`)
                            // replace renderSlot with vue-cryo:renderSlot
                            s.replace(/_renderSlot\(/g, 'cryoRenderSlot(_ctx, ')
                            console.log(s.toString())
                            return {
                                code: s.toString(),
                                map: s.generateMap({ hires: true }).toString(),
                            }
                        }
                    }
                }
            }
        ],
    }
}


function getVuePlugin(options?: Options) {
    const plugin = vue(defu({
        exclude: [VSC_PREFIX_RE],
    }, options))
    return plugin;
}

function getPatchedServerVue(options?: Options): PluginOption {
    const plugin = vue(defu(options, {
        include: [VSC_PREFIX_RE],
        exclude: [NOVSC_PREFIX_RE]
    }))
    // need to force non-ssr transform to always render vnode
    const oldTransform = plugin.transform;
    plugin.transform = async function (code, id, _options) {
        // @ts-expect-error blabla
        return await Reflect.apply(oldTransform, this, [code, id, { ssr: false }]);
    };
    const oldLoad = plugin.load;
    plugin.load = async function (id, _options) {
        // @ts-expect-error blabla
        return await Reflect.apply(oldLoad, this, [id, { ssr: false }]);
    };

    return plugin;
}