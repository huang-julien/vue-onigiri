
import type { Plugin } from "vite"
import { hash } from "ohash"
import MagicString from "magic-string"
import type { ExportDefaultDeclaration } from "acorn"
import { join, normalize, relative } from "node:path"
import { readFileSync } from "node:fs"

export type Options = {
    include: string[]
    rootDir?: string
}

export function vueServerComponentsPlugin(options?: Partial<Options>): { client: Plugin, server: Plugin } {
    const VIRTUAL_MODULE_ID = 'virtual:components-chunk'
    const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID
    const refs: { path: string, id: string }[] = []
    let assetDir: string = ''
    let isProduction = false
    let rootDir = process.cwd()
    return {
        client: {
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

                        }
                    }
                }
                console.log('refs', refs)
            }
        },

        server: {
            enforce: 'pre',
            name: 'vite:vue-server-components-server',
            resolveId(id, importer) {
                if (id === VIRTUAL_MODULE_ID) {
                    return RESOLVED_VIRTUAL_MODULE_ID
                }
              
                if(id.startsWith('virtual:vsc:')) {
                    if(id.includes('?vue')) {
                        return id.replace('virtual:vsc:', '') 
                    }
                }
                if (id.endsWith('?chunk')) {
                    return id
                }
                if(importer?.startsWith('virtual:vsc:')) {
                    return this.resolve(id, importer.replace(/\?chunk$/, '').replace(/virtual:vsc:/, ''), {skipSelf: true})
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
                    if (id.endsWith('.vue')) {
                        this.emitFile({
                            type: 'chunk',
                            fileName: hash(id) + '.lol.mjs',
                            id: `virtual:vsc:` + id + '?chunk',
                            preserveSignature: 'strict',
                         })
                    }
                    if(id.endsWith('?chunk')) {
                      const file = id.replace(/\?chunk$/, '').replace(/virtual:vsc:/, '')
                        console.log(file)
                      return {
                        code: readFileSync(file, 'utf-8')
                      }
                    }
                    // if (id.endsWith('?chunk')) {
                    //     const resolved = await this.resolve(id.replace(/\?chunk$/, ''), undefined, {skipSelf: true})
                    //     if (resolved) {
                    //         const loaded = await this.load({id})
                    //         console.log(loaded.code)
                    //         return {
                    //             code:`// @ts-ignore \n${ loaded.code}`,
                    //             map: null,
                    //         }
                    //     }
                    // }
                }
            },

            generateBundle(_, bundle) {
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
