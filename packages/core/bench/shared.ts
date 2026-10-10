export type RenderMode = "mount" | "hydrate";

/** Generated per row count by `bench:size`, consumed by the client pages. */
export interface GeneratedCase {
  rows: number;
  payload: unknown;
  vueHtml: string;
  onigiriHtml: string;
}

/** Row counts drive every bench; `Tree.vue` emits about five VNodes per row. */
export const ROW_COUNTS = [10, 1000, 10_000] as const;

export const RENDER_MODES: RenderMode[] = ["mount", "hydrate"];

export const PERF_ENTRY = "render";
