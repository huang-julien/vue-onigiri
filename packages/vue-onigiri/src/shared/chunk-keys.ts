/**
 * Keys a chunk reference may be registered under in a loader table:
 * as written, then with its leading slash toggled.
 */
export function chunkKeys(spec: string): [string, string] {
  return [spec, spec.startsWith("/") ? spec.slice(1) : "/" + spec];
}
