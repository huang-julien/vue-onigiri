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

// Identifiers we control or inject; never prefixed.
const ONIGIRI_RESERVED = ["_ctx", "__instance", "$event"];

/**
 * Fallback classifier for v-on values that skipped the
 * `transformVOnEventKind` transform, using the same Babel parser Vue uses.
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
 * Extract the identifier names a binding pattern declares (`{ id }`,
 * `[a, b]`, `{ a: alias = 1, ...rest }`); prefixIdentifiers needs the
 * individual names in localVars or bindings get wrongly rewritten.
 */
export function collectBindingNames(pattern: string): string[] {
  const trimmed = pattern.trim();
  if (!trimmed) return [];
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return [trimmed];

  try {
    const arrow: any = parseExpression(`(${trimmed}) => 0`, { plugins: ["typescript"] });
    const names: string[] = [];
    const walk = (n: any): void => {
      if (!n) return;
      switch (n.type) {
        case "Identifier": {
          names.push(n.name);
          return;
        }
        case "ObjectPattern": {
          for (const p of n.properties) walk(p);
          return;
        }
        case "ObjectProperty": {
          walk(n.value);
          return;
        }
        case "ArrayPattern": {
          for (const el of n.elements) walk(el);
          return;
        }
        case "AssignmentPattern": {
          walk(n.left);
          return;
        }
        case "RestElement": {
          walk(n.argument);
          return;
        }
      }
    };
    for (const param of arrow.params ?? []) walk(param);
    return names;
  } catch {
    // Unparseable pattern: return raw; the template is about to error anyway.
    return [trimmed];
  }
}

/**
 * Strip TS-only syntax positions (`as T`, `satisfies`, `<T>expr`, `!`,
 * `: T` annotations); the emitted virtual `.mjs` must parse as plain JS.
 */
function collectTsStripRanges(node: any, s: MagicString): void {
  if (!node || typeof node !== "object") return;

  switch (node.type) {
    case "TSAsExpression":
    case "TSSatisfiesExpression": {
      // `expr as T` / `expr satisfies T` → keep `expr`, drop the rest.
      if (node.expression?.end != null && node.end != null) {
        s.remove(node.expression.end, node.end);
      }
      break;
    }
    case "TSTypeAssertion": {
      // `<T>expr` → keep `expr`.
      if (node.expression?.start != null && node.start != null) {
        s.remove(node.start, node.expression.start);
      }
      break;
    }
    case "TSNonNullExpression": {
      // `expr!` → keep `expr`.
      if (node.expression?.end != null && node.end != null) {
        s.remove(node.expression.end, node.end);
      }
      break;
    }
    case "TSInstantiationExpression": {
      // `expr<T, U>` → keep `expr`.
      if (node.expression?.end != null && node.end != null) {
        s.remove(node.expression.end, node.end);
      }
      break;
    }
    case "TSTypeAnnotation": {
      // `(x: T) => …` → drop `: T` from the param.
      if (node.start != null && node.end != null) {
        s.remove(node.start, node.end);
      }
      return;
    }
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
 * Prefix free identifiers with `_ctx.` so the render reads bindings off
 * the instance proxy. `localVars` carries outer scope (v-for bindings);
 * the same walk strips TS-only syntax so the emitted `.mjs` parses as JS.
 */
export function prefixIdentifiers(
  content: string,
  _bindingMetadata: BindingMetadata = {},
  localVars: Set<string> = new Set(),
): string {
  if (!content.trim()) return content;

  // Collapse Vue's `$setup.` / `$props.` / `$data.` / `$options.` prefixes;
  // the `_ctx` proxy resolves all namespaces uniformly.
  content = content.replace(/\$(?:setup|props|data|options)\./g, "");

  let ast: any;
  try {
    // A single expression covers the overwhelming majority of template content.
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
      // Unparseable (usually a precursor to a Vue error): leave untouched.
      return content;
    }
  }

  const s = new MagicString(content);

  // Strip TS-only syntax first (drops `as T`, `!`, `<T>`, etc).
  collectTsStripRanges(ast, s);

  // knownIds entries are treated as locals: v-for vars + reserved render args.
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
 * Wrap an event handler like Vue does: member/fn expressions pass through,
 * inline statements wrap as `$event => (expr)` or `$event => { expr }`.
 * Classification normally comes from `transformVOnEventKind`.
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
    // Reassemble to one string then prefix once; otherwise property
    // accessors after a dot get treated as bindings.
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
