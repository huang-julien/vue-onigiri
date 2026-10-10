/// <reference types="vite/client" />

import { type RenderMode, type GeneratedCase, PERF_ENTRY } from "../shared";

interface PageParams {
  rows: number;
  mode: RenderMode;
}

const GENERATED = import.meta.glob<{ default: GeneratedCase }>("./generated/*.json");

export function readParams(): PageParams {
  const params = new URLSearchParams(location.search);
  const rows = Number(params.get("rows") ?? 1000);
  const mode = params.get("mode") === "hydrate" ? "hydrate" : "mount";
  return { rows, mode };
}

export async function loadGenerated(rows: number): Promise<GeneratedCase> {
  const load = GENERATED[`./generated/${rows}.json`];
  if (!load) throw new Error(`[bench] no generated case for rows=${rows}, run bench:size`);
  return (await load()).default;
}

/** Marks the window tachometer reads via its `performance` measurement mode. */
export function measure(render: () => void): void {
  performance.mark("render-start");
  render();
  performance.measure(PERF_ENTRY, "render-start");
}
