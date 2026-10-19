import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/** Packages published in lockstep; the first one drives the changelog and version. */
const PACKAGES = ["vue-onigiri"] as const;
const LEAD = `packages/${PACKAGES[0]}`;

run("pnpm test");
run(`changelogen --release --no-commit --no-tag --no-github --dir ${LEAD}`);

const version = readVersion(LEAD);
for (const name of PACKAGES.slice(1)) syncVersion(`packages/${name}`, version);

run("git add -A");
run(`git commit -m "chore(release): v${version}"`);
run(`git tag -am "v${version}" v${version}`);
run("pnpm publish:all");
run("git push --follow-tags");
run(`changelogen gh release --dir ${LEAD}`);

function run(command: string): void {
  execSync(command, { stdio: "inherit" });
}

function readVersion(dir: string): string {
  return (JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as { version: string }).version;
}

function syncVersion(dir: string, next: string): void {
  const path = `${dir}/package.json`;
  const pkg = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  pkg.version = next;
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
}
