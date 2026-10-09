// Client entry for the client-bundle test: imports the app shell the way a
// browser bundle would, plus the manifest so `clientInclude: "auto"` emits
// the island chunk.
import App from "./App.vue";

export { App };
export { importFn } from "virtual:onigiri/manifest";
