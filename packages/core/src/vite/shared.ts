/**
 * Cross-plugin singleton (the two plugins are wired up independently):
 * the compiler registers v-load-client targets, the manifest plugin reads
 * them for its precise glob and gets invalidated when a new one appears.
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
  return [...targets];
}

/** Test/SSR-restart helper: resets the singleton state. */
export function _resetOnigiriTargets(): void {
  targets.clear();
  invalidateManifest = undefined;
}
