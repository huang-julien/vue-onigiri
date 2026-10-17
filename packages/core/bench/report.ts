import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface VitestBenchmark {
  name: string;
  median: number;
  mean: number;
  p99: number;
  sampleCount: number;
}

interface VitestBenchGroup {
  fullName: string;
  benchmarks: VitestBenchmark[];
}

interface VitestBenchReport {
  files: { groups: VitestBenchGroup[] }[];
}

interface SizeRow {
  rows: number;
  htmlBytes: number;
  htmlGzipBytes: number;
  payloadBytes: number;
  payloadGzipBytes: number;
  markedHtmlBytes: number;
  markedHtmlGzipBytes: number;
  htmlFirstGzipBytes?: number;
}

interface SizeReport {
  nodeEnv?: string;
  sizes: SizeRow[];
  islandSizes?: (SizeRow & { every: number })[];
}

/** Marker the CI step searches for, so one PR keeps a single comment. */
const COMMENT_MARKER = "<!-- vue-onigiri-bench -->";

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

main();

function main(): void {
  const client = readJson<VitestBenchReport>("client.json");
  const sizes = readJson<SizeReport>("payload-size.json");

  const sections = [
    COMMENT_MARKER,
    "## 🍙 Runtime benchmarks",
    process.env.BENCH_COMMIT ? `Commit: \`${process.env.BENCH_COMMIT}\`` : "",
    "",
    "SSR and compiler timings are tracked by CodSpeed, see its check on this PR.",
    "",
    clientSection(client),
    islandSection(client),
    sizeSection(sizes),
    "<sub>Ratios are onigiri / Vue, lower is better. Timings come from one CI runner and should be read as ratios, not absolutes.</sub>",
  ];

  const markdown = sections.filter((s) => s !== "").join("\n");
  writeFileSync(`${RESULTS_DIR}report.md`, `${markdown}\n`);
  console.log(markdown);
}

function readJson<T>(file: string): T | undefined {
  const path = `${RESULTS_DIR}${file}`;
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function groups(report: VitestBenchReport): VitestBenchGroup[] {
  return report.files.flatMap((file) => file.groups);
}

function clientSection(report: VitestBenchReport | undefined): string {
  if (!report)
    return "### Client (Chromium)\n\n_Skipped. Add the `bench` label to the PR to run it._\n";

  const lines = [
    "| rows | mode | vue | onigiri | ratio | onigiri-dom | ratio |",
    "|---|---|---:|---:|---:|---:|---:|",
  ];
  for (const group of groups(report)) {
    const m = group.fullName.match(/client (\w+) rows=(\d+)/);
    if (!m) continue;
    const byName = new Map(group.benchmarks.map((b) => [b.name, b]));
    const vue = byName.get("vue");
    lines.push(
      `| ${m[2]} | ${m[1]} | ${cell(vue)} | ${cell(byName.get("onigiri"))} | ${ratio(byName.get("onigiri"), vue)} | ${cell(byName.get("onigiri-dom"))} | ${ratio(byName.get("onigiri-dom"), vue)} |`,
    );
  }

  return `### Client (headless Chromium, Playwright)\n\nMean per \`mount()\` plus unmount, since Chromium rounds single timings to 0.1 ms. \`onigiri-dom\` hydrates from the marked HTML with \`domToVNode\`.\n\n${lines.join("\n")}\n`;
}

function islandSection(report: VitestBenchReport | undefined): string {
  if (!report) return "";

  const hydrate = [
    "| rows | vue | onigiri | ratio | onigiri-dom | ratio | onigiri-dom html-first | ratio |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  const refresh = [
    "| rows | vue static | renderOnigiri | ratio | htmlToVNode | ratio | htmlToVNode html-first | ratio |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const group of groups(report)) {
    const m = group.fullName.match(/island (\w+) rows=(\d+)/);
    if (!m) continue;
    const byName = new Map(group.benchmarks.map((b) => [b.name, b]));
    if (m[1] === "hydrate") {
      const vue = byName.get("vue");
      hydrate.push(
        `| ${m[2]} | ${cell(vue)} | ${cells(byName, vue, ["onigiri", "onigiri-dom", "onigiri-dom html-first"])} |`,
      );
    } else if (m[1] === "refresh") {
      const vue = byName.get("vue static");
      refresh.push(
        `| ${m[2]} | ${cell(vue)} | ${cells(byName, vue, ["onigiri renderOnigiri", "onigiri htmlToVNode", "onigiri htmlToVNode html-first"])} |`,
      );
    }
  }
  if (hydrate.length === 2 && refresh.length === 2) return "";

  return `### Island with client components (Chromium)\n\n\`Island.vue\`: one \`v-load-client\` counter every 100 rows. \`html-first\` is Vue's own SSR output with markers written by \`v-load-client\`, no AST.\n\nHydrate, mean per \`mount()\` plus unmount:\n\n${hydrate.join("\n")}\n\nRefresh, mean per tree swap plus patch. \`vue static\` replaces the island HTML like legacy islands do.\n\n${refresh.join("\n")}\n`;
}

function cells(
  byName: Map<string, VitestBenchmark>,
  base: VitestBenchmark | undefined,
  names: string[],
): string {
  return names
    .map((name) => `${cell(byName.get(name))} | ${ratio(byName.get(name), base)}`)
    .join(" | ");
}

function sizeSection(report: SizeReport | undefined): string {
  if (!report) return "";

  const header = [
    "| rows | HTML gzip | payload gzip | ratio | marked HTML gzip | ratio |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  const sizeLine = (s: SizeRow): string =>
    `| ${s.rows} | ${formatBytes(s.htmlGzipBytes)} | ${formatBytes(s.payloadGzipBytes)} | ${(s.payloadGzipBytes / s.htmlGzipBytes).toFixed(2)}x | ${formatBytes(s.markedHtmlGzipBytes)} | ${(s.markedHtmlGzipBytes / s.htmlGzipBytes).toFixed(2)}x |`;

  const tree = [...header, ...report.sizes.map(sizeLine)];
  const islandHeader = [`${header[0]} html-first gzip | ratio |`, `${header[1]}---:|---:|`];
  const islandLine = (s: SizeRow): string =>
    s.htmlFirstGzipBytes === undefined
      ? sizeLine(s)
      : `${sizeLine(s)} ${formatBytes(s.htmlFirstGzipBytes)} | ${(s.htmlFirstGzipBytes / s.htmlGzipBytes).toFixed(2)}x |`;
  const island = report.islandSizes?.length
    ? `\nSame for \`Island.vue\`:\n\n${[...islandHeader, ...report.islandSizes.map(islandLine)].join("\n")}\n`
    : "";

  return `### Wire size\n\nVue SSR HTML vs the onigiri JSON payload vs the marked HTML for the same tree, gzipped.\n\n${tree.join("\n")}\n${island}`;
}

function cell(b: VitestBenchmark | undefined): string {
  return b ? formatMs(b.mean) : "n/a";
}

function ratio(b: VitestBenchmark | undefined, base: VitestBenchmark | undefined): string {
  return b && base ? `${(b.mean / base.mean).toFixed(2)}x` : "n/a";
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toPrecision(3)} µs`;
  return `${ms.toPrecision(3)} ms`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}
