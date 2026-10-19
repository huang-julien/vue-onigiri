import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Package name owning each directory, `null` when none was found; shared by every build.
 */
const PACKAGE_NAMES = new Map<string, string | null>();

/**
 * Convert an absolute path to a root-relative `/`-prefixed form, the shape
 * used for import maps, glob keys and descriptor chunks. Paths outside
 * `root` keep only slash normalisation.
 */
export function toRootRelative(absPath: string, root: string): string {
  const normalisedRoot = root.replaceAll("\\", "/").replace(/\/$/, "");
  const normalised = absPath.replaceAll("\\", "/");
  if (normalised.startsWith(normalisedRoot + "/")) {
    return normalised.slice(normalisedRoot.length);
  }
  return normalised;
}

/**
 * Bare specifier of a file inside an npm package, `<name>/<path in package>`,
 * matching how a consumer imports a raw `.vue` from it. `undefined` without a named package.json.
 */
export function toPackageSpecifier(filePath: string): string | undefined {
  let dir = path.dirname(filePath);
  for (;;) {
    const name = packageNameOf(dir);
    if (name) return `${name}/${path.relative(dir, filePath).replaceAll("\\", "/")}`;
    const parent = path.dirname(dir);
    if (parent === dir || path.basename(dir) === "node_modules") return undefined;
    dir = parent;
  }
}

function packageNameOf(dir: string): string | undefined {
  let name = PACKAGE_NAMES.get(dir);
  if (name === undefined) {
    name = null;
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name ?? null;
      } catch {
        // An unreadable package.json names no package.
      }
    }
    PACKAGE_NAMES.set(dir, name);
  }
  return name ?? undefined;
}
