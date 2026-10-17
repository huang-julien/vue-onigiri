import type { App } from "vue";

export type RenderMode = "mount" | "hydrate";

/** Generated per row count by `bench:size`, consumed by the client pages. */
export interface GeneratedCase {
  rows: number;
  payload: unknown;
  vueHtml: string;
  onigiriHtml: string;
  /** Server HTML carrying the metadata needed for DOM hydration. */
  onigiriMarkedHtml: string;
}

/** Generated per island case by `bench:size`; `next*` is the same tree with every label changed. */
export interface GeneratedIslandCase {
  rows: number;
  every: number;
  payload: unknown;
  vueHtml: string;
  onigiriMarkedHtml: string;
  /** Vue SSR in one pass, markers written by `v-load-client` and bound to `htmlFirstNonce`. */
  htmlFirstHtml: string;
  htmlFirstNonce: string;
  nextPayload: unknown;
  nextVueHtml: string;
  nextMarkedHtml: string;
  nextHtmlFirstHtml: string;
  nextHtmlFirstNonce: string;
}

/** Row counts drive every bench; `Tree.vue` emits about five VNodes per row. */
export const ROW_COUNTS = [10, 1000, 10_000] as const;

/** Chromium rounds timers to 0.1 ms, so the client side skips the smallest tree. */
export const CLIENT_ROW_COUNTS = [1000, 10_000] as const;

/** `Island.vue` cases: one `v-load-client` counter every `every` rows. */
export const ISLAND_CASES = [
  { rows: 1000, every: 100 },
  { rows: 10_000, every: 100 },
] as const;

export const RENDER_MODES: RenderMode[] = ["mount", "hydrate"];

export const PERF_ENTRY = "render";

/** Plain Vue baseline for `Island.vue`: the directive only has to resolve, it does nothing. */
export function withLoadClient(app: App): App {
  return app.directive("load-client", {});
}
