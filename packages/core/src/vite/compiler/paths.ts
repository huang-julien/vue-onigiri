/**
 * Convert an absolute path to a root-relative `/`-prefixed form, the shape
 * used across the compiler (importMap, glob keys, AST chunks). Paths
 * outside `root` keep only slash normalisation.
 */
export function toRootRelative(absPath: string, root: string): string {
  const normalisedRoot = root.replaceAll("\\", "/").replace(/\/$/, "");
  const normalised = absPath.replaceAll("\\", "/");
  if (normalised.startsWith(normalisedRoot + "/")) {
    return normalised.slice(normalisedRoot.length);
  }
  return normalised;
}
