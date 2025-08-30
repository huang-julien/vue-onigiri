import "./assets/main.css";

import { createApp, Suspense, h } from "vue";
import App from "./App.vue";

createApp({
    setup() {
        return () =>  h(Suspense, null, {

            default: () => h(App)
        }
        )
    }
}).mount("#app");
