import path from "node:path";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Parse `<script>` block imports and build a map of local identifier →
 * root-relative source path (e.g. `Foo` → `/components/Foo.vue`). The
 * compiler uses this to inline literal chunk paths in the AST when an
 * imported component appears in the template.
 *
 * Only relative imports (`./`, `../`) are tracked — package and aliased
 * imports aren't local components.
 */
export function buildImportMap(
  scriptContent: string,
  currentFilePath: string,
  root: string,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!scriptContent) return map;

  const importRegex = /import\s+(?!type\b)([^;]+?)\s+from\s+['"](\.\.?\/[^'"]+)['"]/g;
  for (const match of scriptContent.matchAll(importRegex)) {
    const [, clauseRaw, source] = match;
    if (!clauseRaw || !source) continue;

    const abs = path.resolve(path.dirname(currentFilePath), source);
    const rel = "/" + normalizePath(path.relative(root, abs));

    for (const id of parseImportClause(clauseRaw.trim())) {
      map.set(id, rel);
    }
  }
  return map;
}

function parseImportClause(clause: string): string[] {
  const results: string[] = [];
  const namedMatch = clause.match(/\{([^}]*)\}/);
  const defaultPart = namedMatch
    ? clause.slice(0, namedMatch.index).replace(/,\s*$/, "").trim()
    : clause.trim();

  if (defaultPart && !defaultPart.startsWith("*")) {
    const clean = defaultPart.replace(/^type\s+/, "");
    if (clean && /^[a-zA-Z_$][\w$]*$/.test(clean)) {
      results.push(clean);
    }
  }

  if (namedMatch?.[1]) {
    for (const raw of namedMatch[1].split(",")) {
      const spec = raw.trim();
      if (!spec || spec.startsWith("type ")) continue;
      const asMatch = spec.match(/^\S+\s+as\s+([a-zA-Z_$][\w$]*)$/);
      if (asMatch?.[1]) {
        results.push(asMatch[1]);
      } else if (/^[a-zA-Z_$][\w$]*$/.test(spec)) {
        results.push(spec);
      }
    }
  }

  return results;
}

/** Strip type-only imports / specifiers from a `<script>` block. */
export function extractScriptImports(scriptContent: string): string {
  if (!scriptContent) return "";
  const importRegex = /^import\s+.+?from\s+['"].+?['"];?\s*$/gm;
  const imports = scriptContent.match(importRegex);
  if (!imports) return "";

  const cleaned = imports
    .filter((imp) => !/^import\s+type\s+/.test(imp))
    .map((imp) =>
      imp.replace(/\{([^}]*)\}/g, (_match, inner) => {
        const inner_ = inner
          .split(",")
          .map((s: string) => s.trim())
          .filter((s: string) => !s.startsWith("type "))
          .join(", ");
        return inner_ ? `{ ${inner_} }` : "";
      }),
    )
    .filter((imp) => !/^import\s+\{\s*\}\s+from/.test(imp) && !/^import\s+from/.test(imp));

  return cleaned.length > 0 ? cleaned.join("\n") + "\n" : "";
}
