/**
 * Convert an absolute file path to a root-relative path with forward
 * slashes and a leading `/` — matches the shape used everywhere else
 * in the compiler (importMap entries, manifest glob keys, AST chunk
 * strings). Paths outside `root` are returned with their backslashes
 * normalised but otherwise unchanged; the SSR resolver handles those
 * directly.
 */
export function toRootRelative(absPath: string, root: string): string {
  const normalisedRoot = root.replaceAll("\\", "/").replace(/\/$/, "");
  const normalised = absPath.replaceAll("\\", "/");
  if (normalised.startsWith(normalisedRoot + "/")) {
    return normalised.slice(normalisedRoot.length);
  }
  return normalised;
}
