import { createHash } from 'node:crypto'
import path from 'node:path'

function getHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8)
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * Mirrors `@vitejs/plugin-vue`'s scope-id derivation so our compiled
 * output matches the SFC's scoped CSS attribute selectors.
 */
export function generateScopeId(filePath: string, source: string, root: string, isProduction: boolean): string {
  const relativePath = normalizePath(path.relative(root, filePath))
  const hashInput = isProduction ? relativePath + source : relativePath
  return `data-v-${getHash(hashInput)}`
}
