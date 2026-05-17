/**
 * Cross-plugin shared state. The compiler registers every
 * `v-load-client` target it sees into `targets`; the manifest plugin
 * reads from it to emit a precise `import.meta.glob([...paths])`
 * instead of a broad `/**\/*.vue` glob. When the compiler sees a new
 * target after the manifest has already been loaded, it calls the
 * invalidator the manifest plugin registered — Vite re-`load`s the
 * virtual on the next request with the full set.
 *
 * Singleton because the two plugins are wired up independently (host
 * apps call `onigiriCompilerPlugin` and `onigiriManifestPlugin`
 * separately). If multiple isolated vue-onigiri instances ever need
 * to coexist in one process this becomes a problem, but that's not a
 * shape any current consumer hits.
 */
const targets = new Set<string>();
let invalidateManifest: (() => void) | undefined;

export function registerOnigiriTarget(sourcePath: string): void {
  if (targets.has(sourcePath)) return;
  targets.add(sourcePath);
  invalidateManifest?.();
}

export function setOnigiriManifestInvalidator(fn: () => void): void {
  invalidateManifest = fn;
}

export function getOnigiriTargets(): readonly string[] {
  return Array.from(targets);
}

/** Test/SSR-restart helper — resets the singleton state. */
export function _resetOnigiriTargets(): void {
  targets.clear();
  invalidateManifest = undefined;
}
