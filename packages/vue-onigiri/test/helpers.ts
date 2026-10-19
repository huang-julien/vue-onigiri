import { compileTemplate } from "@vue/compiler-sfc";
import * as serverRenderer from "@vue/server-renderer";
import * as Vue from "vue";
import { defineComponent, h, ref, type Component } from "vue";
import { expect, type MockInstance } from "vitest";
import {
  COMPONENT_MARKER_TYPE,
  createMarkerSet,
  decodeMarker,
  encodeMarker,
  type OnigiriComponentMarker,
  type OnigiriTeleportMarker,
} from "../src/shared/markers";
import * as boundaryModule from "../src/server/ssr-boundary";
import { ssrLoadClientTransform } from "../src/vite/compiler/ssr-load-client";

export interface CompileOptions {
  /** Compile without the onigiri transform, as plain Vue would. */
  plain?: boolean;
  scoped?: boolean;
  /** Scope id suffix, `data-v-<id>` when scoped. */
  id?: string;
  /** @default true */
  ssr?: boolean;
}

export const NONCE = "f00d1234abcd5678";
export const MARKERS = createMarkerSet(NONCE);
export const BADGE_CHUNK = "/test/html-first/Badge.vue";

/** Hand-written client component carrying the descriptor the Vite plugin would attach. */
export const Badge = defineComponent({
  name: "Badge",
  props: { label: { type: String, required: true }, count: { type: Number, default: 0 } },
  setup(props) {
    const clicks = ref(props.count);
    return () =>
      h("button", { "data-badge": props.label, onClick: () => clicks.value++ }, [
        `${props.label}:${clicks.value}`,
      ]);
  },
});
(Badge as any).__onigiriDescriptor = { chunk: BADGE_CHUNK };

/** Compile a template with Vue's SFC compiler, with the onigiri transform unless `plain`. */
export function compileCode(source: string, options: CompileOptions = {}): string {
  const { code, errors } = compileTemplate({
    source,
    filename: "Island.vue",
    id: options.id ?? "island",
    ssr: options.ssr ?? true,
    ssrCssVars: [],
    scoped: options.scoped,
    compilerOptions: { nodeTransforms: options.plain ? [] : [ssrLoadClientTransform] },
  });
  expect(errors).toEqual([]);
  return code;
}

/** Compile a template as Vue SSR and evaluate it against local deps. */
export function compileSsr(source: string, options: CompileOptions = {}): (...args: any[]) => void {
  const code = compileCode(source, options);
  const deps: Record<string, unknown> = {
    vue: Vue,
    "vue/server-renderer": serverRenderer,
    "vue-onigiri/server": boundaryModule,
  };
  const body = code
    .replace(/import \{([^}]*)\} from ["']([^"']+)["']/g, (_, names: string, path: string) => {
      return `const {${names.replaceAll(" as ", ": ")}} = __deps[${JSON.stringify(path)}]`;
    })
    .replace("export function ssrRender", "return function ssrRender");
  return new Function("__deps", body)(deps);
}

/** Island root whose template is compiled as Vue SSR, with `components` registered locally. */
export function islandComponent(
  template: string,
  state: () => Record<string, unknown>,
  components: Record<string, Component>,
  options: CompileOptions = {},
): Component {
  return defineComponent({
    __scopeId: options.scoped ? "data-v-island" : undefined,
    components,
    setup: state,
    ssrRender: compileSsr(template, options),
  });
}

/** Every component marker tuple in `html`, in document order. */
export function markerTuples(html: string): OnigiriComponentMarker[] {
  return decodeAll<OnigiriComponentMarker>(html, MARKERS.component);
}

/** Every teleport marker tuple in `html`, in document order. */
export function teleportTuples(html: string): OnigiriTeleportMarker[] {
  return decodeAll<OnigiriTeleportMarker>(html, MARKERS.teleport);
}

/** Remove every nonce-bound marker comment. */
export function stripMarkers(html: string): string {
  return html.replace(new RegExp(`<!--/?o:[ct]:${NONCE}[\\s\\S]*?-->`, "g"), "");
}

/** A component marker region around `body`, as `ssrRenderClientComponent` writes it. */
export function componentMarkerHtml(
  chunk: string,
  body: string,
  props?: Record<string, any>,
  slots?: Record<string, string>,
): string {
  const tuple: OnigiriComponentMarker = [COMPONENT_MARKER_TYPE, props ?? null, chunk, "default"];
  if (slots) tuple.push(slots);
  return `<!--${MARKERS.component}${encodeMarker(tuple)}-->${body}<!--${MARKERS.componentEnd}-->`;
}

/** Hydration warnings and errors Vue reported through the console spies. */
export function hydrationComplaints(warn: MockInstance, error: MockInstance): string[] {
  return [...warn.mock.calls, ...error.mock.calls]
    .map((call) => String(call[0]))
    .filter((message) => /hydrat|mismatch/i.test(message));
}

function decodeAll<T>(html: string, marker: string): T[] {
  const prefix = `<!--${marker}`;
  const tuples: T[] = [];
  for (let at = html.indexOf(prefix); at !== -1; at = html.indexOf(prefix, at + 1)) {
    const end = html.indexOf("-->", at);
    tuples.push(decodeMarker<T>(html.slice(at + prefix.length, end)));
  }
  return tuples;
}
