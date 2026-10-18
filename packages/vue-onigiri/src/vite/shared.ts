/**
 * Targets the scan registers and the manifest's `"auto"` includes read,
 * shared by one scan plugin and one manifest plugin.
 */
export interface OnigiriRegistry {
  /**
   * Records a `v-load-client` target, invalidating the manifest when it is new.
   */
  register: (sourcePath: string) => void;
  /**
   * Lists every registered target in registration order.
   */
  targets: () => readonly string[];
  /**
   * Sets the callback that invalidates the manifest module, replacing the previous one.
   */
  setInvalidator: (fn: () => void) => void;
}

/**
 * Option shared by the standalone scan and manifest plugins.
 */
export interface OnigiriRegistryOption {
  /**
   * Registry the scan writes `v-load-client` targets to and the manifest reads them from.
   *
   * @default a registry shared by every standalone plugin of the process
   */
  registry?: OnigiriRegistry;
}

/**
 * Create a target registry; `onigiriPlugins` creates one per call.
 */
export function createOnigiriRegistry(): OnigiriRegistry {
  const targets = new Set<string>();
  let invalidate: (() => void) | undefined;
  return {
    register(sourcePath) {
      if (targets.has(sourcePath)) return;
      targets.add(sourcePath);
      invalidate?.();
    },
    targets: () => [...targets],
    setInvalidator(fn) {
      invalidate = fn;
    },
  };
}

/**
 * Default of the standalone plugins, so a scan and a manifest wired separately still see each other.
 */
export const sharedOnigiriRegistry: OnigiriRegistry = createOnigiriRegistry();
