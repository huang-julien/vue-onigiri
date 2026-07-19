import type { InjectionKey } from "vue";

/**
 * Symbol used to signal that we're in onigiri render mode.
 * When this symbol is provided, setup should return the onigiri render function
 * instead of the normal render function.
 */
export const ONIGIRI_RENDER_SYMBOL: InjectionKey<true> = /* #__PURE__ */ Symbol.for("onigiri-render");

export const ONIGIRI_PAYLOAD_VERSION = 1;

/** Versioned envelope produced by `serializeApp` / `serializeComponent`. */
export interface OnigiriPayload {
  v: number;
  ast: VServerComponent | undefined;
}

export enum VServerComponentType {
  Element,
  Component,
  Text,
  Fragment,
  Suspense,
  /** Raw HTML string - rendered using createStaticVNode */
  StaticHtml,
  /** Comment vnode - rendered using createCommentVNode */
  Comment,
  Teleport,
}
type Tag = string;
type ChunkPath = string;
type Children = VServerComponent[] | undefined;
type Props = Record<string, any> | undefined;
type Attrs = Record<string, any> | undefined;
type Slots = Record<string, Children> | undefined;
type VServerComponentElement = [VServerComponentType.Element, Tag, Attrs, Children];

export type VServerComponentComponent = [
  VServerComponentType.Component,
  Props,
  ChunkPath,
  // export name (defaults to "default" at the loader)
  string?,
  Slots?,
];
type VServerComponentText = [VServerComponentType.Text, string];
type VServerComponentComment = [VServerComponentType.Comment, string];
type VServerComponentFragment = [VServerComponentType.Fragment, Children];
type VServerComponentSuspense = [
  VServerComponentType.Suspense,
  VServerComponent[] | undefined,
  // fallback children
  (VServerComponent[] | undefined)?,
];
type VServerComponentTeleport = [
  VServerComponentType.Teleport,
// selector
  string,
  // disabled
  boolean | undefined,
  Children,
];

/**
 * Static HTML content - rendered as raw HTML using createStaticVNode.
 * Used by v-html directive.
 * Format: [type, htmlString, nodeCount]
 * nodeCount is needed by Vue's createStaticVNode for hydration.
 */
type VServerComponentStaticHtml = [
  VServerComponentType.StaticHtml,
  string, // HTML string
  number, // Number of root nodes (for createStaticVNode)
];

export type MaybePromise<T> = T | Promise<T>;

type VServerComponentElementBuffered = [
  VServerComponentType.Element,
  Tag,
  Attrs,
  MaybePromise<(VServerComponentBuffered | undefined)[]> | undefined,
];

type VServerComponentComponentBuffered = [
  VServerComponentType.Component,
  Props,
  ChunkPath,
  // export name
  string,
  MaybePromise<Record<string, VServerComponent[] | undefined>> | undefined,
];
type VServerComponentTextBuffered = [VServerComponentType.Text, string];
type VServerComponentCommentBuffered = [VServerComponentType.Comment, string];
type VServerComponentFragmentBuffered = [
  VServerComponentType.Fragment,
  MaybePromise<VServerComponentBuffered[]> | undefined,
];
type VServerComponentSuspenseBuffered = [
  VServerComponentType.Suspense,
  MaybePromise<VServerComponentBuffered[]> | undefined,
  (MaybePromise<VServerComponentBuffered[]> | undefined)?,
];
type VServerComponentTeleportBuffered = [
  VServerComponentType.Teleport,
  string,
  boolean | undefined,
  MaybePromise<(VServerComponentBuffered | undefined)[]> | undefined,
];

type VServerComponentStaticHtmlBuffered = [VServerComponentType.StaticHtml, string, number];

export type VServerComponentBuffered
  = | VServerComponentElementBuffered
    | VServerComponentComponentBuffered
    | VServerComponentTextBuffered
    | VServerComponentCommentBuffered
    | VServerComponentFragmentBuffered
    | VServerComponentSuspenseBuffered
    | VServerComponentTeleportBuffered
    | VServerComponentStaticHtmlBuffered;

export type VServerComponent
  = | VServerComponentElement
    | VServerComponentComponent
    | VServerComponentText
    | VServerComponentComment
    | VServerComponentFragment
    | VServerComponentSuspense
    | VServerComponentTeleport
    | VServerComponentStaticHtml;

/**
 * The render function signature for onigiri components.
 * When ONIGIRI_RENDER_SYMBOL is provided, setup returns this function.
 * It has direct access to setup bindings and returns serialized VNode structures.
 */
export type RenderOnigiriFunction = () => VServerComponentBuffered | null;

/**
 * A component that can be used with renderToSerializedVNode.
 * When compiled with ?onigiri, setup checks for ONIGIRI_RENDER_SYMBOL
 * and returns a RenderOnigiriFunction if present.
 */
export interface OnigiriComponent {
  setup?: (...args: any[]) => any;
  props?: any;
  [key: string]: any;
}
