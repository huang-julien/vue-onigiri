import path from "node:path";
import { toRootRelative } from "./paths";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Bundler resolver (`PluginContext.resolve` bound to the importing SFC). */
export type ResolveImportFn = (source: string) => Promise<string | null | undefined>;

/**
 * Map each `<script>` import's local identifier to the chunk path baked into v-load-client tuples (e.g. `Foo` → `/components/Foo.vue`).
 * Sources go through the bundler resolver when available, so aliases and package imports resolve.
 * Resolutions under `root` become root-relative paths; node_modules resolutions keep their bare specifier.
 * Without a resolver, relative imports fall back to plain path joining.
 */
export async function buildImportMap(
  scriptContent: string,
  currentFilePath: string,
  root: string,
  resolveImport?: ResolveImportFn,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!scriptContent) return map;

  const importRegex = /import\s+(?!type\b)([^;]+?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const match of scriptContent.matchAll(importRegex)) {
    const [, clauseRaw, source] = match;
    if (!clauseRaw || !source) continue;

    const chunkPath = await resolveImportSource(source, currentFilePath, root, resolveImport);
    if (!chunkPath) continue;

    for (const id of parseImportClause(clauseRaw.trim())) {
      map.set(id, chunkPath);
    }
  }
  return map;
}

async function resolveImportSource(
  source: string,
  currentFilePath: string,
  root: string,
  resolveImport?: ResolveImportFn,
): Promise<string | undefined> {
  const isRelative = source.startsWith("./") || source.startsWith("../");

  if (resolveImport) {
    const resolved = await resolveImport(source);
    if (resolved) {
      const clean = resolved.split("?")[0]!;
      // A node_modules file path is useless to the client glob; the bare specifier stays mappable by the host.
      if (!isRelative && clean.includes("node_modules")) {
        return source;
      }
      return toRootRelative(clean, root);
    }
  }

  if (!isRelative) return undefined;

  const abs = path.resolve(path.dirname(currentFilePath), source);
  return "/" + normalizePath(path.relative(root, abs));
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
