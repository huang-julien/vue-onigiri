export const enum VServerComponentType {
  Element,
  Component,
  Text,
  Fragment,
  Suspense,
}
type Tag = string;
type ChunkPath = string;
type Children = VServerComponent[] | undefined;
type Props = Record<string, any> | undefined;
type Attrs = Record<string, any> | undefined;
type Slots = Record<string, Children> | undefined;
type VServerComponentElement = [
  VServerComponentType.Element,
  Tag,
  Attrs,
  Children,
];

type VServerComponentComponent = [
  VServerComponentType.Component,
  Props,
  ChunkPath,
  Slots,
];
type VServerComponentText = [VServerComponentType.Text, string];
type VServerComponentFragment = [VServerComponentType.Fragment, Children];
type VServerComponentSuspense = [VServerComponentType.Suspense, Children];

export type VServerComponent =
  | VServerComponentElement
  | VServerComponentComponent
  | VServerComponentText
  | VServerComponentFragment
  | VServerComponentSuspense;
