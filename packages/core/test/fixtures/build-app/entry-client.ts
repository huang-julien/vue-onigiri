// Client entry for the production-build e2e: importing the virtual
// manifest is what forces the browser bundler to resolve extraEntries
// and emit a client chunk for the package component.

export { importFn } from "virtual:onigiri/manifest";
