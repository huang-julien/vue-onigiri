import { h, type DefineComponent, defineComponent } from "vue";
import type { VServerComponentComponent } from "../shared";
import { renderChildren } from "../deserialize";

const componentMap = new Map<string, DefineComponent>()

export default defineComponent({
    name: 'vsc:loader',
    props: {
        data: {
            type: Object as () => VServerComponentComponent,
            required: true
        }
    } ,
    async setup(props) {
        const hasComponent = componentMap.has(props.data.chunk)
        if(!hasComponent) {
            console.log('loading component', props.data.chunk)
            const { default: component } = await import(/* @vite-ignore */ props.data.chunk)
            console.log(component, 'LOADED')
            componentMap.set(props.data.chunk, component)
        }
        return () => {
            const component = componentMap.get(props.data.chunk)
            console.log('component', component)
            if(component) {
                return h(component, props.data.props, {
                    default: () => renderChildren(props.data.children),
                })
            }
        }
    }
})