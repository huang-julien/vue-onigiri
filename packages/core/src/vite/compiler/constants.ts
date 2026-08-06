/**
 * Virtual module id for the per-SFC render: `virtual:onigiri:<encoded-path>.mjs`.
 * No `\0` prefix (breaks Vite's `/@id/` round-trip on Windows paths); the
 * `.mjs` suffix keeps plugin-vue's `.vue` filter off our generated JS.
 */
export const ONIGIRI_PREFIX = "virtual:onigiri:";
export const ONIGIRI_SUFFIX = ".mjs";
