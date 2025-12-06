import "./assets/main.css";
import { loadClientDirective} from "vue-onigiri/runtime/utils"
import { createApp, Suspense, h } from "vue";
import App from "./App.vue";

createApp({
    setup() {
        return () =>  h(Suspense, null, {

            default: () => h(App)
        }
        )
    },
    directives: {
        'load-client': loadClientDirective
    }
}).mount("#app");
