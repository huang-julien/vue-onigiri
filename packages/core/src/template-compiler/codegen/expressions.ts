import {
  type BindingMetadata,
  type CompoundExpressionNode,
  type ExpressionNode,
  type SimpleExpressionNode,
  NodeTypes,
  walkIdentifiers,
} from "@vue/compiler-dom";
import { parse, parseExpression } from "@babel/parser";
import MagicString from "magic-string";
import type { CodegenContext } from "./context";

const JS_KEYWORDS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "NaN",
  "Infinity",
  "this",
  "arguments",
  "window",
  "document",
  "console",
  "Array",
  "Object",
  "String",
  "Number",
  "Boolean",
  "Date",
  "Math",
  "JSON",
  "RegExp",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
]);

// Identifiers we control / inject — never prefixed.
const ONIGIRI_RESERVED = ["_ctx", "__instance", "$event"];

/**
 * Fallback classifier for v-on values that didn't pass through the
 * `transformVOnEventKind` node transform (e.g. compound-expression
 * v-on values, or programmatic callers that skip the standard pipeline).
 * Uses the same `@babel/parser` Vue uses internally.
 */
function classifyExpression(content: string): "member" | "fn" | "statement" {
  const trimmed = content.trim();
  if (!trimmed) return "statement";
  try {
    const ast = parseExpression(trimmed, { plugins: ["typescript"] });
    if (ast.type === "ArrowFunctionExpression" || ast.type === "FunctionExpression") return "fn";
    if (
      ast.type === "Identifier" ||
      ast.type === "MemberExpression" ||
      ast.type === "OptionalMemberExpression"
    )
      return "member";
    return "statement";
  } catch {
    return "statement";
  }
}

/**
 * Walk the Babel AST and remove TypeScript-only syntax positions
 * (`expr as T`, `expr satisfies T`, `<T>expr`, `expr!`, `expr<T>`,
 * parameter `: T` annotations). The virtual `.mjs` modules we emit
 * are parsed by Rollup as plain JavaScript — any leftover TS syntax
 * is a parse error, so we strip before `prefixIdentifiers` runs.
 */
function collectTsStripRanges(node: any, s: MagicString): void {
  if (!node || typeof node !== "object") return;

  switch (node.type) {
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      // `expr as T` / `expr satisfies T` → keep `expr`, drop the rest.
      if (node.expression?.end != null && node.end != null) {
        s.remove(node.expression.end, node.end);
      }
      break;
    case "TSTypeAssertion":
      // `<T>expr` → keep `expr`.
      if (node.expression?.start != null && node.start != null) {
        s.remove(node.start, node.expression.start);
      }
      break;
    case "TSNonNullExpression":
      // `expr!` → keep `expr`.
      if (node.expression?.end != null && node.end != null) {
        s.remove(node.expression.end, node.end);
      }
      break;
    case "TSInstantiationExpression":
      // `expr<T, U>` → keep `expr`.
      if (node.expression?.end != null && node.end != null) {
        s.remove(node.expression.end, node.end);
      }
      break;
    case "TSTypeAnnotation":
      // `(x: T) => …` → drop `: T` from the param.
      if (node.start != null && node.end != null) {
        s.remove(node.start, node.end);
      }
      return;
  }

  for (const key in node) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
    const value = (node as any)[key];
    if (Array.isArray(value)) {
      for (const child of value) collectTsStripRanges(child, s);
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      collectTsStripRanges(value, s);
    }
  }
}

/**
 * Prefix free identifiers with `_ctx.` so the compiled render reads
 * bindings off the instance proxy. Parses with `@babel/parser` (TS
 * plugin) and walks identifiers via Vue's `walkIdentifiers`, which
 * understands JS scope, destructuring, property keys, template
 * literals, and TS type-annotation positions.
 *
 * `localVars` carries scope from outer constructs the parser doesn't
 * see (e.g. `v-for` loop bindings); they're seeded into `walkIdentifiers`'
 * known-id set alongside our reserved render-function args.
 *
 * `bindingMetadata` is unused — onigiri's `_ctx` proxy resolves all
 * binding namespaces uniformly, so every free identifier gets the
 * same `_ctx.` prefix regardless of where it came from.
 *
 * The same AST walk also strips TS-only positions (see
 * `collectTsStripRanges`) so the emitted virtual `.mjs` parses as
 * plain JS.
 */
export function prefixIdentifiers(
  content: string,
  _bindingMetadata: BindingMetadata = {},
  localVars: Set<string> = new Set(),
): string {
  if (!content.trim()) return content;

  // Vue's `transformExpression` adds `$setup.` / `$props.` / `$data.` /
  // `$options.` namespace prefixes for SSR. Our `_ctx` proxy resolves
  // across all namespaces, so collapse them so we emit `_ctx.foo` instead
  // of `_ctx.$setup.foo`.
  content = content.replace(/\$(?:setup|props|data|options)\./g, "");

  let ast: any;
  try {
    // Try as a single expression first — covers the overwhelming majority
    // (interpolations, prop bindings, member/fn-style v-on values).
    ast = parseExpression(content, { plugins: ["typescript"] });
  } catch {
    try {
      // Multi-statement v-on bodies (`a++; b()`) parse as a Program.
      ast = parse(content, {
        plugins: ["typescript"],
        sourceType: "module",
        allowReturnOutsideFunction: true,
      }).program;
    } catch {
      // Unparseable (rare — usually a precursor to a Vue error elsewhere).
      // Leave the content untouched rather than corrupting it.
      return content;
    }
  }

  const s = new MagicString(content);

  // Strip TS-only syntax first (drops `as T`, `!`, `<T>`, etc).
  collectTsStripRanges(ast, s);

  // Vue's `walkIdentifiers` treats anything in `knownIds` as a local —
  // exactly what we need for v-for vars + our reserved render args.
  const knownIds: Record<string, number> = Object.create(null);
  for (const v of localVars) knownIds[v] = (knownIds[v] || 0) + 1;
  for (const v of ONIGIRI_RESERVED) knownIds[v] = (knownIds[v] || 0) + 1;

  walkIdentifiers(
    ast,
    (node, parent, _parentStack, isReference, isLocal) => {
      if (!isReference || isLocal) return;
      if (JS_KEYWORDS.has(node.name)) return;
      const start = (node as any).start as number | undefined;
      if (start == null) return;

      // Shorthand object props need expansion: `{ foo }` -> `{ foo: _ctx.foo }`.
      if (parent && (parent as any).type === "ObjectProperty" && (parent as any).shorthand) {
        s.appendLeft(start, `${node.name}: _ctx.`);
        return;
      }

      s.appendLeft(start, "_ctx.");
    },
    true,
    [],
    knownIds,
  );
  return s.toString();
}

/**
 * Wrap an event handler the same way Vue does:
 *   - member / function expressions: pass through
 *   - single inline statement: wrap as `$event => (expr)`
 *   - multiple statements: wrap as `$event => { expr }`
 *
 * The classification ideally comes from `transformVOnEventKind` (which
 * uses Vue's own `isFnExpression` / `isMemberExpression` helpers during
 * the transform pass). The regex helpers below are fallbacks for callers
 * that didn't go through the standard transform pipeline.
 */
function wrapEventHandler(
  content: string,
  kind: "member" | "fn" | "statement" | undefined,
  context: CodegenContext,
): string {
  const trimmed = content.trim();
  const resolved = kind ?? classifyExpression(trimmed);

  if (resolved === "member" || resolved === "fn") {
    return prefixIdentifiers(trimmed, context.bindingMetadata, context.localVars);
  }

  const hasMultipleStatements = trimmed.includes(";");
  const prefixed = prefixIdentifiers(trimmed, context.bindingMetadata, context.localVars);

  return hasMultipleStatements ? `$event => { ${prefixed} }` : `$event => (${prefixed})`;
}

export function genExpressionAsValue(
  node: ExpressionNode | undefined,
  context: CodegenContext,
): void {
  if (!node) {
    context.push("undefined");
    return;
  }

  if (node.type === NodeTypes.SIMPLE_EXPRESSION) {
    const simpleNode = node as SimpleExpressionNode;
    if (simpleNode.isStatic) {
      context.push(simpleNode.content);
    } else {
      context.push(
        prefixIdentifiers(simpleNode.content, context.bindingMetadata, context.localVars),
      );
    }
  } else if (node.type === NodeTypes.COMPOUND_EXPRESSION) {
    // Reassemble the compound expression to one string, then prefix once —
    // otherwise property accessors after a dot get treated as bindings.
    const compound = node as CompoundExpressionNode;
    let flat = "";
    for (const child of compound.children) {
      if (typeof child === "string") {
        flat += child;
      } else if (typeof child === "symbol") {
        continue;
      } else if (child && typeof child === "object" && "type" in child) {
        if (child.type === NodeTypes.SIMPLE_EXPRESSION) {
          flat += (child as SimpleExpressionNode).content;
        } else if (child.type === NodeTypes.COMPOUND_EXPRESSION) {
          let nested = "";
          const tmp: CodegenContext = {
            ...context,
            code: "",
            push(s: string) {
              nested += s;
            },
            indent() {
              this.indentLevel++;
            },
            deindent() {
              this.indentLevel--;
            },
            newline() {
              nested += "\n";
            },
          };
          genExpressionAsValue(child as ExpressionNode, tmp);
          flat += nested;
        }
      }
    }
    context.push(prefixIdentifiers(flat, context.bindingMetadata, context.localVars));
  }
}

export function genEventHandler(node: ExpressionNode | undefined, context: CodegenContext): void {
  if (!node) {
    context.push("() => {}");
    return;
  }

  if (node.type === NodeTypes.SIMPLE_EXPRESSION) {
    const simpleNode = node as SimpleExpressionNode & {
      _onigiriEventKind?: "member" | "fn" | "statement";
    };
    if (simpleNode.isStatic) {
      context.push(simpleNode.content);
    } else {
      context.push(wrapEventHandler(simpleNode.content, simpleNode._onigiriEventKind, context));
    }
  } else if (node.type === NodeTypes.COMPOUND_EXPRESSION) {
    const compound = node as CompoundExpressionNode;
    const content = compound.children
      .map((child) => {
        if (typeof child === "string") {
          return child;
        }
        if (
          child &&
          typeof child === "object" &&
          "type" in child &&
          child.type === NodeTypes.SIMPLE_EXPRESSION
        ) {
          return (child as SimpleExpressionNode).content;
        }
        return "";
      })
      .join("");
    context.push(wrapEventHandler(content, undefined, context));
  }
}
