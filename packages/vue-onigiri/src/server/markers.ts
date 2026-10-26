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
