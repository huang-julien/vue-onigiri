import { AsyncLocalStorage } from "node:async_hooks";
import type { Plugin } from "vite";

/** Lookup half of a capture plugin instance, exposed as the plugin's `api`. */
export interface SourceCaptureApi {
  getCapturedSource(filePath: string, environment?: string): string | undefined;
}

type CaptureLookup = (filePath: string) => string | undefined;

const CAPTURE_PLUGIN_NAME = "vite:vue-onigiri-source-capture";

const captureStorage = new AsyncLocalStorage<CaptureLookup>();

/**
 * Vite plugin capturing each `.vue` module's source as it flows through the
 * transform pipeline. `onigiriCompilerPlugin` compiles from these captures
 * instead of reading the SFC from disk.
 */
export function onigiriSourceCapturePlugin(): Plugin {
  // SFC source keyed by `<environment>\0<normalized file path>`.
  const capturedSources = new Map<string, string>();

  const api: SourceCaptureApi = {
    getCapturedSource(filePath, environment) {
      const key = normalizeCapturePath(filePath);
      // Exact environment first; the plain key covers hooks without environment info.
      return (
        capturedSources.get(captureKey(key, environment)) ??
        (environment === undefined ? undefined : capturedSources.get(captureKey(key, undefined)))
      );
    },
  };

  return {
    name: CAPTURE_PLUGIN_NAME,
    enforce: "pre",
    api,
    transform(code, id) {
      const [filename, query] = id.split("?", 2);
      if (filename && filename.endsWith(".vue") && !query) {
        capturedSources.set(
          captureKey(normalizeCapturePath(filename), this.environment?.name),
          code,
        );
      }
    },
  };
}

/** The capture plugin's `api` in a resolved plugin list, or `undefined` when it isn't registered. */
export function findSourceCaptureApi(
  plugins: readonly Plugin[] | undefined,
): SourceCaptureApi | undefined {
  return plugins?.find((plugin) => plugin.name === CAPTURE_PLUGIN_NAME)?.api as
    | SourceCaptureApi
    | undefined;
}

/** Run `fn` with `lookup` visible to every `getCapturedSource` call in its async chain. */
export function runWithCapturedSources<T>(lookup: CaptureLookup, fn: () => T): T {
  return captureStorage.run(lookup, fn);
}

/** Captured source for an SFC through the ambient lookup, or `undefined` outside one. */
export function getCapturedSource(filePath: string): string | undefined {
  return captureStorage.getStore()?.(filePath);
}

function captureKey(normalizedPath: string, environment: string | undefined): string {
  return `${environment ?? ""}\0${normalizedPath}`;
}

/** Slash-normalize and strip Vite's `/@fs/` URL prefix so Windows and dev-URL spellings share one key. */
function normalizeCapturePath(filePath: string): string {
  let normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith("/@fs/")) {
    normalized = normalized.slice("/@fs".length);
    if (/^\/[A-Za-z]:\//.test(normalized)) normalized = normalized.slice(1);
  }
  return normalized;
}
