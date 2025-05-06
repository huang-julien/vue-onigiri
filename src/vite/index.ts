 
import type { Plugin } from "rollup"
import { basename} from "path"
export type Options = {
    include: string[]
    rootDir?: string
}

export function vueServerComponentsPlugin(options?: Partial<Options>): {client: Plugin, server: Plugin} {
    const refs: { path: string, ref: string }[] = []
    return {
        client: {
            name: 'vite:vue-server-components-client',
            async buildStart( )  {
                if (options?.include) {
                    for(const path of options.include) {
                        const filePath = await this.resolve(path)
                        if (filePath) {
                           const ref = this.emitFile({
                                type: 'chunk',
                                id: filePath.id,
                                fileName: basename(filePath.id) + '.mjs',
                            })
                            refs.push({path: filePath.id, ref})
                        }
                    }
                }
            }
        },
        server: {
            name: 'vite:vue-server-components-server',
            
        }
    }
}