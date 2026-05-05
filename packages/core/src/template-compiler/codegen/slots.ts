import {
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  type SimpleExpressionNode,
  NodeTypes,
} from "@vue/compiler-dom";
import { genImport } from "knitwork";
import type { CodegenContext } from "./context";
import { genNode } from "./vnode";
import { genExpressionAsValue } from "./expressions";
import { genProps } from "./props";

interface ParsedSlot {
  name: string;
  slotProps: string | null;
  children: any[];
}

function parseSlots(children: any[]): ParsedSlot[] {
  const slots: ParsedSlot[] = [];
  const defaultChildren: any[] = [];

  for (const child of children) {
    if (child.type === NodeTypes.ELEMENT && child.tag === "template") {
      const slotDirective = child.props?.find(
        (p: any) => p.type === NodeTypes.DIRECTIVE && p.name === "slot",
      ) as DirectiveNode | undefined;

      if (slotDirective) {
        let slotName = "default";
        if (slotDirective.arg && slotDirective.arg.type === NodeTypes.SIMPLE_EXPRESSION) {
          slotName = (slotDirective.arg as SimpleExpressionNode).content;
        }

        // Destructured slot params (e.g. `#default="{ item }"`) come through
        // as COMPOUND_EXPRESSION without a flat `.content` — fall back to loc.
        let slotProps: string | null = null;
        if (slotDirective.exp) {
          if (slotDirective.exp.type === NodeTypes.SIMPLE_EXPRESSION) {
            slotProps = (slotDirective.exp as SimpleExpressionNode).content;
          } else if (slotDirective.exp.loc?.source) {
            slotProps = slotDirective.exp.loc.source;
          }
        }

        slots.push({
          name: slotName,
          slotProps,
          children: child.children || [],
        });
        continue;
      }
    }

    defaultChildren.push(child);
  }

  if (defaultChildren.length > 0) {
    slots.push({
      name: "default",
      slotProps: null,
      children: defaultChildren,
    });
  }

  return slots;
}

export function genSlotsObject(
  children: any[],
  context: CodegenContext,
  asFunction: boolean,
): void {
  const slots = parseSlots(children);

  if (slots.length === 0) {
    context.push("undefined");
    return;
  }

  context.push("{ ");

  for (const [i, slot] of slots.entries()) {
    if (i > 0) context.push(", ");

    context.push(`"${slot.name}": `);

    if (asFunction) {
      if (slot.slotProps) {
        context.push(`(${slot.slotProps}) => `);
      } else {
        context.push("() => ");
      }
      context.push("[");
      for (const [j, child] of slot.children.entries()) {
        if (j > 0) context.push(", ");
        genNode(child, context);
      }
      context.push("]");
    } else {
      // Scoped slots can't cross the client boundary — the scope value only
      // exists on the client at runtime and can't be embedded in frozen AST.
      if (slot.slotProps) {
        throw new Error(
          `[vue-onigiri] Scoped slots are not supported on client-loaded components ('v-load-client'). ` +
            `Slot "${slot.name}" declares scope "${slot.slotProps}" but the scope is only available on ` +
            `the client and cannot be embedded in pre-rendered AST.`,
        );
      }
      if (slot.children.length === 1) {
        genNode(slot.children[0], context);
      } else {
        context.push("[");
        for (const [j, child] of slot.children.entries()) {
          if (j > 0) context.push(", ");
          genNode(child, context);
        }
        context.push("]");
      }
    }
  }

  context.push(" }");
}

/**
 * Compile `<slot>` outlets to `__renderSlot(_ctx, _ctx.slots, name, props, fallback)`.
 */
export function genSlotOutlet(node: ElementNode, context: CodegenContext): void {
  const { props, children } = node;

  context.imports.add(
    genImport("vue-onigiri/runtime/render-slot", [{ name: "renderSlot", as: "__renderSlot" }]),
  );

  let slotName: string | null = null;
  let isDynamicName = false;
  const slotProps: (AttributeNode | DirectiveNode)[] = [];

  for (const prop of props) {
    if (prop.type === NodeTypes.ATTRIBUTE && prop.name === "name") {
      slotName = prop.value ? `"${prop.value.content}"` : '"default"';
    } else if (
      prop.type === NodeTypes.DIRECTIVE &&
      prop.name === "bind" &&
      prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
      prop.arg.content === "name"
    ) {
      isDynamicName = true;
      slotName = null;
      (node as any).__dynamicSlotNameExp = prop.exp;
    } else {
      slotProps.push(prop);
    }
  }

  context.push("__renderSlot(_ctx, _ctx.slots, ");

  if (isDynamicName && (node as any).__dynamicSlotNameExp) {
    genExpressionAsValue((node as any).__dynamicSlotNameExp, context);
  } else {
    context.push(slotName || '"default"');
  }
  context.push(", ");

  if (slotProps.length > 0) {
    genProps(slotProps, context);
  } else {
    context.push("undefined");
  }
  context.push(", ");

  if (children.length > 0) {
    context.push("() => ");
    if (children.length === 1) {
      genNode(children[0], context);
    } else {
      context.push("[");
      for (const [i, child] of children.entries()) {
        if (i > 0) context.push(", ");
        genNode(child, context);
      }
      context.push("]");
    }
  } else {
    context.push("undefined");
  }

  context.push(")");
}
