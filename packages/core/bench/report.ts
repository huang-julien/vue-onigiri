import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface VitestBenchmark {
  name: string;
  median: number;
  p99: number;
  sampleCount: number;
}

interface VitestBenchReport {
  files: { groups: { fullName: string; benchmarks: VitestBenchmark[] }[] }[];
}

interface TachometerBenchmark {
  name: string;
  mean: { low: number; high: number };
  samples?: number[];
}

interface TachometerReport {
  benchmarks: TachometerBenchmark[];
}

interface SizeReport {
  nodeEnv?: string;
  sizes: {
    rows: number;
    htmlBytes: number;
    htmlGzipBytes: number;
    payloadBytes: number;
    payloadGzipBytes: number;
  }[];
}

/** Marker the CI step searches for, so one PR keeps a single comment. */
const COMMENT_MARKER = "<!-- vue-onigiri-bench -->";

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

const SSR_COLUMNS = [
  "vue renderToString",
  "onigiri serializeComponent",
  "onigiri serialize + renderToString",
];

main();

function main(): void {
  const ssr = readJson<VitestBenchReport>("ssr.json");
  const client = readJson<TachometerReport>("client.json");
  const sizes = readJson<SizeReport>("payload-size.json");

  const sections = [
    COMMENT_MARKER,
    "## 🍙 Runtime benchmarks",
    process.env.BENCH_COMMIT ? `Commit: \`${process.env.BENCH_COMMIT}\`` : "",
    "",
    ssrSection(ssr),
    clientSection(client),
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

function ssrSection(report: VitestBenchReport | undefined): string {
  if (!report) return "### SSR (Node)\n\n_No results, `bench:ssr` did not run._\n";

  const header = `| rows | ${SSR_COLUMNS.join(" | ")} |`;
  const divider = `|---|${SSR_COLUMNS.map(() => "---:").join("|")}|`;
  const lines = [header, divider];

  for (const file of report.files) {
    for (const group of file.groups) {
      const rows = group.fullName.match(/rows=(\d+)/)?.[1] ?? group.fullName;
      const byName = new Map(group.benchmarks.map((b) => [b.name, b]));
      const base = byName.get(SSR_COLUMNS[0]!)?.median;
      const cells = SSR_COLUMNS.map((name) => {
        const b = byName.get(name);
        if (!b) return "n/a";
        const showRatio = base !== undefined && name !== SSR_COLUMNS[0];
        const ratio = showRatio ? ` (${(b.median / base).toFixed(1)}x)` : "";
        return `${formatMs(b.median)}${ratio}`;
      });
      lines.push(`| ${rows} | ${cells.join(" | ")} |`);
    }
  }

  return `### SSR (Node, production Vue)\n\nMedian per call.\n\n${lines.join("\n")}\n`;
}

function clientSection(report: TachometerReport | undefined): string {
  if (!report) return "### Client (Chrome)\n\n_No results, `bench:client` did not run._\n";

  const byName = new Map(report.benchmarks.map((b) => [b.name, b]));
  const cases = new Set<string>();
  for (const name of byName.keys()) {
    const m = name.match(/^(vue|onigiri) (\w+ rows=\d+)$/);
    if (m) cases.add(m[2]!);
  }

  const lines = ["| rows | mode | vue | onigiri | ratio |", "|---|---|---:|---:|---:|"];
  for (const key of [...cases].toSorted(sortByRows)) {
    const [mode, rowsPart] = key.split(" ");
    const rows = rowsPart!.replace("rows=", "");
    const vue = byName.get(`vue ${key}`);
    const onigiri = byName.get(`onigiri ${key}`);
    const ratio = vue && onigiri ? `${(centre(onigiri) / centre(vue)).toFixed(2)}x` : "n/a";
    const vueCell = vue ? formatCi(vue) : "n/a";
    const onigiriCell = onigiri ? formatCi(onigiri) : "n/a";
    lines.push(`| ${rows} | ${mode} | ${vueCell} | ${onigiriCell} | ${ratio} |`);
  }

  return `### Client (headless Chrome)\n\nMean with 95% confidence interval, per \`mount()\`.\n\n${lines.join("\n")}\n`;
}

function sizeSection(report: SizeReport | undefined): string {
  if (!report) return "";

  const lines = [
    "| rows | HTML | HTML gzip | payload | payload gzip | gzip ratio |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const s of report.sizes) {
    const ratio = (s.payloadGzipBytes / s.htmlGzipBytes).toFixed(2);
    lines.push(
      `| ${s.rows} | ${formatBytes(s.htmlBytes)} | ${formatBytes(s.htmlGzipBytes)} | ${formatBytes(s.payloadBytes)} | ${formatBytes(s.payloadGzipBytes)} | ${ratio}x |`,
    );
  }

  return `### Wire size\n\nVue SSR HTML vs the onigiri JSON payload for the same tree.\n\n${lines.join("\n")}\n`;
}

function centre(b: TachometerBenchmark): number {
  return (b.mean.low + b.mean.high) / 2;
}

function formatCi(b: TachometerBenchmark): string {
  const half = (b.mean.high - b.mean.low) / 2;
  return `${formatMs(centre(b))} ± ${formatMs(half)}`;
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toPrecision(3)} µs`;
  return `${ms.toPrecision(3)} ms`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function sortByRows(a: string, b: string): number {
  const rows = (s: string) => Number(s.match(/rows=(\d+)/)?.[1] ?? 0);
  return rows(a) - rows(b) || a.localeCompare(b);
}
