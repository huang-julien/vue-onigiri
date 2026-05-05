/**
 * Virtual module specifier for the per-SFC onigiri render function:
 *   `virtual:onigiri:<URL-encoded-path>.mjs`
 *
 * No `\0` prefix — that breaks Vite's `/@id/` URL round-trip when the
 * body contains colons / slashes (Windows paths like `D:/…`). The `.mjs`
 * suffix keeps `@vitejs/plugin-vue`'s `.vue` filter from claiming our
 * generated JS.
 */
export const ONIGIRI_PREFIX = "virtual:onigiri:";
export const ONIGIRI_SUFFIX = ".mjs";
