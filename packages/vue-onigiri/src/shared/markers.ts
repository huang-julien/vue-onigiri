/**
 * Descriptor of a `v-load-client` component, carried by its `o:c` marker:
 * type tag, props without listeners, chunk, export name and slot HTML.
 */
export type OnigiriComponentMarker = [
  type: typeof COMPONENT_MARKER_TYPE,
  props: Record<string, any> | null,
  chunk: string,
  exportName?: string,
  slots?: Record<string, string>,
];

/**
 * Descriptor of a server-rendered teleport, carried by its `o:t` marker; `html` is omitted when disabled.
 */
export type OnigiriTeleportMarker = [to: string, disabled: boolean, html?: string];

/**
 * Comment data of every marker kind, bound to one render's nonce.
 */
export interface MarkerSet {
  component: string;
  componentEnd: string;
  teleport: string;
}

/**
 * Component marker comment prefix.
 */
export const MARKER_COMPONENT = "o:c";
/**
 * Component region closing comment.
 */
export const MARKER_COMPONENT_END = "/o:c";
/**
 * Teleport marker comment prefix.
 */
export const MARKER_TELEPORT = "o:t";
/**
 * First element of every component marker tuple.
 */
export const COMPONENT_MARKER_TYPE = 1;

const MARKER_NONCE_MIN_LENGTH = 16;
const MARKER_NONCE_RE = /^[A-Za-z0-9]+$/;

/**
 * Whether a value can bind markers: a string of 16 or more alphanumeric characters.
 * Hosts check a nonce read from a response with it before building anything from it.
 */
export function isMarkerNonce(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= MARKER_NONCE_MIN_LENGTH &&
    MARKER_NONCE_RE.test(value)
  );
}

/**
 * Build the marker set of a render; the nonce keeps raw HTML from forging a marker.
 */
export function createMarkerSet(nonce: string): MarkerSet {
  if (!MARKER_NONCE_RE.test(nonce)) {
    throw new Error("[vue-onigiri] A marker nonce must be alphanumeric.");
  }
  if (nonce.length < MARKER_NONCE_MIN_LENGTH) {
    throw new Error(
      `[vue-onigiri] A marker nonce must be at least ${MARKER_NONCE_MIN_LENGTH} characters long, ` +
        `got ${nonce.length}. Use \`provideMarkerNonce\` to generate one per render.`,
    );
  }
  return {
    component: `${MARKER_COMPONENT}:${nonce}`,
    componentEnd: `${MARKER_COMPONENT_END}:${nonce}`,
    teleport: `${MARKER_TELEPORT}:${nonce}`,
  };
}

/**
 * Random per-render nonce for marker prefixes, 96 bits as hex.
 */
export function createMarkerNonce(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let nonce = "";
  for (const byte of bytes) nonce += byte.toString(16).padStart(2, "0");
  return nonce;
}

/**
 * Encode a marker tuple without allowing HTML comment delimiters.
 */
export function encodeMarker(value: unknown): string {
  return JSON.stringify(value).replaceAll("--", "-\\u002D").replaceAll("<", "\\u003C");
}

/**
 * Decode the JSON portion of a marker comment.
 */
export function decodeMarker<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}
