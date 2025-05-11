
import type { Plugin } from "vite"
import { hash } from "ohash"
import MagicString from "magic-string"
import type { ExportDefaultDeclaration } from "acorn"
import { join } from "node:path"

export type Options = {
    include: string[]
    rootDir?: string
}

export function vueServerComponentsPlugin(options?: Partial<Options>): { client: Plugin, server: Plugin } {
    const VIRTUAL_MODULE_ID = 'virtual:components-chunk'
    const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID
    const refs: { path: string, id: string }[] = []
    let assetDir: string = ''
    return {
        client: {
            name: 'vite:vue-server-components-client',
            configResolved(config) {
                assetDir = config.build.assetsDir
            },
            async buildStart() {
                if (options?.include) {
                    for (const path of options.include) {
                        const resolved = await this.resolve(path)
                        if (resolved) {
                            const id = this.emitFile({
                                type: 'chunk',
                                fileName: join(assetDir, hash(resolved) + '.mjs'),
                                id: resolved.id,
                                preserveSignature: 'strict',
                            })
                            refs.push({ path: resolved.id, id })
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
            }
        },

        server: {
            name: 'vite:vue-server-components-server',
            resolveId(id) {
                if (id === VIRTUAL_MODULE_ID) {
                    return RESOLVED_VIRTUAL_MODULE_ID
                }
            },
            load(id) {
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
                                { __chunk: ${JSON.stringify(this.getFileName(ref.id))} },
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
