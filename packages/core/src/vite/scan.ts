import { promises as fs } from "node:fs";
import path from "node:path";
import { compileScript, parse as parseSfc } from "@vue/compiler-sfc";
import {
  type DirectiveNode,
  type ElementNode,
  NodeTypes,
  parse as parseTemplate,
} from "@vue/compiler-dom";
import type { AdditionalImport } from "../template-compiler/codegen/context";
import { tagCasings } from "../template-compiler/codegen/tag-casings";
import { type ScriptImports, buildImportMap } from "./compiler/imports";
import { toRootRelative } from "./compiler/paths";

export interface OnigiriScanOptions {
  /**
   * Limits the scan to these directories, absolute or relative to the Vite root.
   *
   * @default ["."]
   */
  include?: string[];
  /** Skips these directory names during the scan, on top of the built-in defaults. */
  exclude?: string[];
}

export interface ScanClientTargetsOptions extends OnigiriScanOptions {
  root: string;
  additionalImports: Map<string, AdditionalImport>;
  isCustomElement?: (tag: string) => boolean;
  /** Bundler resolver so aliased and package imports resolve like in transform. */
  resolveImport?: (source: string, importer: string) => Promise<string | null | undefined>;
  registerTarget: (sourcePath: string) => void;
  warn: (message: string) => void;
}

const MARKER = "v-load-client";
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".output",
  ".nuxt",
  ".nitro",
  ".vercel",
  ".netlify",
  "coverage",
]);

/**
 * buildStart pre-pass: find every `v-load-client` target reachable from the
 * project's SFC templates and register it before any environment builds, so
 * the manifest's `"auto"` includes are complete in the client bundle too.
 */
export async function scanClientTargets(options: ScanClientTargetsOptions): Promise<void> {
  const { root, include, exclude } = options;
  const excluded = new Set([...EXCLUDED_DIRS, ...(exclude ?? [])]);
  const dirs = (include?.length ? include : ["."]).map((dir) => path.resolve(root, dir));

  const files: string[] = [];
  for (const dir of dirs) {
    await collectSfcFiles(dir, excluded, files);
  }
  await Promise.all(files.map((file) => scanFile(file, options)));
}

async function collectSfcFiles(dir: string, excluded: Set<string>, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) {
        await collectSfcFiles(path.join(dir, entry.name), excluded, out);
      }
    } else if (entry.name.endsWith(".vue")) {
      out.push(path.join(dir, entry.name));
    }
  }
}

async function scanFile(filePath: string, options: ScanClientTargetsOptions): Promise<void> {
  const source = await fs.readFile(filePath, "utf8");
  // Literal prefilter: only files that can possibly carry the marker get parsed.
  if (!source.includes(MARKER)) return;

  const { descriptor, errors } = parseSfc(source, { filename: filePath, sourceMap: false });
  // Malformed SFCs are reported by the real transform, not the pre-pass.
  if (errors.length > 0 || !descriptor.template) return;

  const marked = findMarkedTags(descriptor.template.content);
  if (marked.length === 0) return;

  const { root, additionalImports, isCustomElement, resolveImport, registerTarget, warn } = options;
  let scriptImports: ScriptImports | undefined;
  if (descriptor.scriptSetup || descriptor.script) {
    try {
      scriptImports = compileScript(descriptor, { id: filePath }).imports;
    } catch {
      // Script compile errors are reported by the real transform, not the pre-pass.
    }
  }

  const importMap = await buildImportMap(
    scriptImports,
    filePath,
    root,
    resolveImport ? (spec) => resolveImport(spec, filePath) : undefined,
  );

  const relFile = toRootRelative(filePath, root);
  for (const tag of marked) {
    if (tag === "component" || tag === "Component") {
      warn(
        `[vue-onigiri] ${relFile}: <component :is> with v-load-client cannot be scanned; ` +
          `add its possible targets to the manifest plugin's \`clientInclude\` manually.`,
      );
      continue;
    }
    if (isCustomElement?.(tag)) continue;

    const sourcePath = lookupTag(tag, importMap, additionalImports);
    if (sourcePath) {
      registerTarget(sourcePath);
    } else {
      warn(
        `[vue-onigiri] ${relFile}: cannot resolve v-load-client target "${tag}" through the ` +
          `file's <script> imports or \`additionalImports\`; its chunk will be missing from ` +
          `the "auto" manifest.`,
      );
    }
  }
}

/** Tags of every element carrying the marker, static or bound, in template order. */
function findMarkedTags(template: string): string[] {
  const tags: string[] = [];
  const visit = (nodes: any[]): void => {
    for (const node of nodes) {
      if (node?.type !== NodeTypes.ELEMENT) continue;
      const el = node as ElementNode;
      const hasMarker = el.props.some(
        (p): p is DirectiveNode => p.type === NodeTypes.DIRECTIVE && p.name === "load-client",
      );
      if (hasMarker) tags.push(el.tag);
      if (el.children?.length) visit(el.children as any[]);
    }
  };
  visit(parseTemplate(template).children as any[]);
  return tags;
}

function lookupTag(
  tag: string,
  importMap: Map<string, string>,
  additionalImports: Map<string, AdditionalImport>,
): string | undefined {
  for (const key of tagCasings(tag)) {
    const fromImportMap = importMap.get(key);
    if (fromImportMap) return fromImportMap;
    const fromAdditional = additionalImports.get(key);
    if (fromAdditional) return fromAdditional.path;
  }
  return undefined;
}
