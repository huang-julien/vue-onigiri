import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PERF_ENTRY, RENDER_MODES, ROW_COUNTS } from "../shared.ts";

interface TachometerBenchmark {
  name: string;
  url: string;
  browser: { name: string; headless: boolean };
  measurement: { mode: "performance"; entryName: string };
}

interface TachometerConfig {
  root: string;
  sampleSize: number;
  timeout: number;
  autoSampleConditions?: string[];
  benchmarks: TachometerBenchmark[];
}

const TACH_BIN = fileURLToPath(
  new URL("../../node_modules/tachometer/bin/tach.js", import.meta.url),
);
const CONFIG_DIR = fileURLToPath(new URL("../results/tachometer/", import.meta.url));
const OUTPUT_FILE = fileURLToPath(new URL("../results/client.json", import.meta.url));

/** Quick local runs: `BENCH_SAMPLE_SIZE=5 pnpm bench:client` skips auto-sampling. */
const SAMPLE_SIZE = Number(process.env.BENCH_SAMPLE_SIZE ?? 50);
const QUICK = process.env.BENCH_SAMPLE_SIZE !== undefined;

main();

/**
 * One tachometer invocation per case, so auto-sampling only has to separate
 * the two pages that matter instead of every pair across all cases.
 */
function main(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const merged: unknown[] = [];

  for (const mode of RENDER_MODES) {
    for (const rows of ROW_COUNTS) {
      const key = `${mode}-${rows}`;
      const configPath = `${CONFIG_DIR}${key}.config.json`;
      const resultPath = `${CONFIG_DIR}${key}.json`;
      writeFileSync(configPath, JSON.stringify(caseConfig(mode, rows), null, 2));

      // tachometer's npm update check rejects before it is awaited on Windows.
      const run = spawnSync(
        process.execPath,
        [
          "--unhandled-rejections=warn",
          TACH_BIN,
          "--config",
          configPath,
          "--json-file",
          resultPath,
        ],
        { stdio: "inherit" },
      );
      if (run.status !== 0) {
        console.error(`[bench] tachometer failed for ${key}`);
        process.exit(run.status ?? 1);
      }

      const { benchmarks } = JSON.parse(readFileSync(resultPath, "utf8")) as {
        benchmarks: unknown[];
      };
      merged.push(...benchmarks);
    }
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify({ benchmarks: merged }, null, 2));
  console.log(`[bench] wrote ${merged.length} results to ${OUTPUT_FILE}`);
}

function caseConfig(mode: string, rows: number): TachometerConfig {
  const page = (impl: string): TachometerBenchmark => ({
    name: `${impl} ${mode} rows=${rows}`,
    url: `../../client/dist/${impl}.html?rows=${rows}&mode=${mode}`,
    browser: { name: "chrome", headless: true },
    measurement: { mode: "performance", entryName: PERF_ENTRY },
  });

  return {
    root: "../../client",
    sampleSize: SAMPLE_SIZE,
    timeout: QUICK ? 0 : 3,
    ...(QUICK ? {} : { autoSampleConditions: ["0%", "10%"] }),
    benchmarks: [page("vue"), page("onigiri")],
  };
}
