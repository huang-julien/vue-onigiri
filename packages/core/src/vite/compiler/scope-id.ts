import { createHash } from "node:crypto";
import path from "node:path";

export type ComponentIdGenerator =
  | "filepath"
  | "filepath-source"
  | ((
      filepath: string,
      source: string,
      isProduction: boolean | undefined,
      getHash: (text: string) => string,
    ) => string);

function getHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Mirrors `@vitejs/plugin-vue`'s scope-id derivation so our compiled
 * output matches the SFC's scoped CSS attribute selectors.
 */
export function generateScopeId(
  filePath: string,
  source: string,
  root: string,
  isProduction: boolean,
  componentIdGenerator?: ComponentIdGenerator,
): string {
  const relativePath = normalizePath(path.relative(root, filePath));
  let hash: string;
  if (componentIdGenerator === "filepath") {
    hash = getHash(relativePath);
  } else if (componentIdGenerator === "filepath-source") {
    hash = getHash(relativePath + source);
  } else if (typeof componentIdGenerator === "function") {
    hash = componentIdGenerator(relativePath, source, isProduction, getHash);
  } else {
    hash = getHash(isProduction ? relativePath + source : relativePath);
  }
  return `data-v-${hash}`;
}
