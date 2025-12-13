import type { InjectionKey } from "vue";

/**
 * Symbol used to signal that we're in onigiri render mode.
 * When this symbol is provided, setup should return the onigiri render function
 * instead of the normal render function.
 */
export const ONIGIRI_RENDER_SYMBOL: InjectionKey<true> = Symbol("onigiri-render");

export const enum VServerComponentType {
  Element,
  Component,
  Text,
  Fragment,
  Suspense,
}
type Tag = string;
type ChunkPath = string;
type Children = VServerComponent | undefined;
type Props = Record<string, any> | undefined;
type Attrs = Record<string, any> | undefined;
type Slots = Record<string, Children> | undefined;
type VServerComponentElement = [
  VServerComponentType.Element,
  Tag,
  Attrs,
  Children,
];

export type VServerComponentComponent = [
  VServerComponentType.Component,
  Props,
  ChunkPath,
  // export name
  string,
  Slots,
];
type VServerComponentText = [VServerComponentType.Text, string];
type VServerComponentFragment = [VServerComponentType.Fragment, Children[]];
type VServerComponentSuspense = [
  VServerComponentType.Suspense,
  VServerComponent[] | undefined,
];

type MaybePromise<T> = T | Promise<T>;

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
type VServerComponentFragmentBuffered = [
  VServerComponentType.Fragment,
  MaybePromise<VServerComponentBuffered[]> | undefined,
];
type VServerComponentSuspenseBuffered = [
  VServerComponentType.Suspense,
  MaybePromise<VServerComponentBuffered[]> | undefined,
];

export type VServerComponentBuffered =
  | VServerComponentElementBuffered
  | VServerComponentComponentBuffered
  | VServerComponentTextBuffered
  | VServerComponentFragmentBuffered
  | VServerComponentSuspenseBuffered;

export type VServerComponent =
  | VServerComponentElement
  | VServerComponentComponent
  | VServerComponentText
  | VServerComponentFragment
  | VServerComponentSuspense;

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
