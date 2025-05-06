import { createTextVNode, type VNode, h, Fragment } from "vue";
import { VServerComponentType, type VServerComponent } from "./shared";


export function renderServerComponent(input?: VServerComponent): VNode | undefined {
    if (!input) return;
    if (input.type === VServerComponentType.Text) {
        return createTextVNode(input.text)
    }
    if (input.type === VServerComponentType.Element) {
        return h(input.tag, input.props, Array.isArray(input.children) ? input.children.map(renderServerComponent) : renderServerComponent(input.children))
    }
    if (input.type === VServerComponentType.Fragment) {
        return Array.isArray(input.children) ? h(Fragment, input.children.map(renderServerComponent)) : renderServerComponent(input.children)
    }
}
