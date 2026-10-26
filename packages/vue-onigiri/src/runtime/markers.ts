/**
 * Decode the JSON portion of a marker comment.
 */
export function decodeMarker<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}
